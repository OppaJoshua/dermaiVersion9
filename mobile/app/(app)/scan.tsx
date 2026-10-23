import { predictSkinCondition, AIPredictionError } from '@/lib/aiApi';
import type { PredictionResult } from '@/lib/aiApi';
import { getConditionGuide } from '@/lib/conditionGuides';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SAMPLE_CLINICS, MAX_FREE_SCANS } from '@/lib/constants';
import LiveCameraModal from '@/components/LiveCameraModal';
import {
  QUESTIONNAIRE_QUESTIONS,
  toggleOptionSelection,
} from '@/lib/questionnaireData';
import type {
  QuestionnaireQuestion,
} from '@/lib/questionnaireData';
import {
  evaluateDiseaseMapping,
  evaluateSafetyWarnings,
  compareAIAndQuestionnaire,
  normalizeAnswers,
} from '@/lib/diseaseMappingService';
import type { SafetyAlert } from '@/lib/diseaseMappingService';
import { CONDITION_MAP } from '@/lib/conditions';
import { DATASET_CONDITIONS, getDatasetCondition } from '@/lib/datasetConditions';
import {
  getCurrentUser,
  saveScanResult,
  getUserSubscription,
  setUserSubscription,
  addAppNotification,
  getClinics,
} from '@/lib/store';
import type { ScanResult, ClinicRecord } from '@/lib/store';

type Step = 'welcome' | 'questionnaire' | 'upload' | 'analyzing' | 'result';

// --- Step indicator ----------------------------------------------------------

const SCAN_STEPS = [
  { number: 1, label: 'Questions' },
  { number: 2, label: 'Photo' },
  { number: 3, label: 'Results' },
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <View style={styles.stepIndicatorRow}>
      {SCAN_STEPS.map((s, i) => {
        const done = currentStep > s.number;
        const active = currentStep === s.number;
        return (
          <View key={s.number} style={styles.stepIndicatorItem}>
            <View style={styles.stepIndicatorLabelRow}>
              {i > 0 && (
                <View style={[styles.stepConnector, (done || active) && styles.stepConnectorActive]} />
              )}
              <View style={[
                styles.stepCircle,
                active && styles.stepCircleActive,
                done && styles.stepCircleDone,
              ]}>
                {done
                  ? <Ionicons name="checkmark" size={14} color="#fff" />
                  : <Text style={[styles.stepCircleTxt, (active || done) && { color: '#fff' }]}>{s.number}</Text>
                }
              </View>
              {i < SCAN_STEPS.length - 1 && (
                <View style={[styles.stepConnector, done && styles.stepConnectorActive]} />
              )}
            </View>
            <Text style={[
              styles.stepIndicatorLabel,
              (active || done) && styles.stepIndicatorLabelActive,
            ]}>{s.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// --- Main screen -------------------------------------------------------------

export default function ScanScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [qIndex, setQIndex] = useState(0);
  const [isReviewing, setIsReviewing] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [referenceImageUri, setReferenceImageUri] = useState<string | null>(null);
  const [liveCameraSlot, setLiveCameraSlot] = useState<'primary' | 'reference' | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scansUsed, setScansUsed] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadScanInfo();
    }, [])
  );

  async function loadScanInfo() {
    const user = await getCurrentUser();
    if (!user) return;
    const isDemoAccount = user.email.toLowerCase().endsWith('@dermai.ph');
    if (isDemoAccount) {
      setIsPremium(true);
      setScansUsed(0);
      return;
    }
    const sub = await getUserSubscription(user.id);
    setIsPremium(sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1);
    setScansUsed(sub?.scansUsed ?? 0);
  }

  async function checkCanScan(): Promise<boolean> {
    const user = await getCurrentUser();
    if (!user) return true;
    const isDemoAccount = user.email.toLowerCase().endsWith('@dermai.ph');
    if (isDemoAccount) return true;
    const sub = await getUserSubscription(user.id);
    if (sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1) return true;
    return (sub?.scansUsed ?? 0) < MAX_FREE_SCANS;
  }

  function reset() {
    setStep('welcome');
    setAnswers({});
    setQIndex(0);
    setIsReviewing(false);
    setImageUri(null);
    setReferenceImageUri(null);
    setLiveCameraSlot(null);
    setResult(null);
    loadScanInfo();
  }

  // Active question and safety warnings
  const currentQuestion: QuestionnaireQuestion =
    QUESTIONNAIRE_QUESTIONS[qIndex] || QUESTIONNAIRE_QUESTIONS[0];
  const currentSelections = answers[currentQuestion.id] || [];
  const hasAnsweredCurrent = currentSelections.length > 0;

  const activeSafetyAlert: SafetyAlert = useMemo(() => {
    return evaluateSafetyWarnings(normalizeAnswers(answers));
  }, [answers]);

  const selectOption = (optId: string) => {
    const cur = answers[currentQuestion.id] || [];
    const updated = toggleOptionSelection(cur, optId, currentQuestion);
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: updated }));
  };

  const goPrevQuestion = () => {
    if (isReviewing) {
      setIsReviewing(false);
      setQIndex(QUESTIONNAIRE_QUESTIONS.length - 1);
      return;
    }
    if (qIndex > 0) {
      setQIndex((prev) => prev - 1);
    } else {
      setStep('welcome');
    }
  };

  const goNextQuestion = () => {
    if (qIndex < QUESTIONNAIRE_QUESTIONS.length - 1) {
      setQIndex((prev) => prev + 1);
    } else {
      setIsReviewing(true);
    }
  };

  const jumpToQuestion = (index: number) => {
    setQIndex(index);
    setIsReviewing(false);
  };

  function promptImageSource(slot: 'primary' | 'reference') {
    Alert.alert(
      slot === 'primary' ? 'Photo 1 — Close-Up View' : 'Photo 2 — Wide-View Area',
      'Take a live picture with your device camera or select an existing photo from your gallery:',
      [
        {
          text: 'Take Live Photo (Camera)',
          onPress: () => setLiveCameraSlot(slot),
        },
        {
          text: 'Choose from Gallery',
          onPress: () => pickImage(slot, false),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function pickImage(slot: 'primary' | 'reference', fromCamera: boolean) {
    const permResult = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permResult.granted) {
      Alert.alert('Permission Required', fromCamera
        ? 'Camera access is needed to take a photo.'
        : 'Photo library access is needed to select an image.');
      return;
    }

    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    };

    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

    if (!res.canceled && res.assets[0]) {
      const uri = res.assets[0].uri;
      if (slot === 'primary') {
        setImageUri(uri);
      } else {
        setReferenceImageUri(uri);
      }
    }
  }

  async function runAnalysis() {
    if (!imageUri) {
      Alert.alert('No Image', 'Please upload or take a photo first.');
      return;
    }

    if (!referenceImageUri) {
      Alert.alert('Second Photo Required', 'Please upload a second photo for anatomical context comparison.');
      return;
    }

    setStep('analyzing');
    const user = await getCurrentUser();

    // 1. Build standardized questionnaire payload
    const questionnaireData = QUESTIONNAIRE_QUESTIONS.map((q) => {
      const chosenIds = answers[q.id] || [];
      const chosenOptions = q.options.filter((o) => chosenIds.includes(o.id));
      const answerEn = chosenOptions.map((o) => o.labelEn).join('; ') || 'Not answered';
      const answerTl = chosenOptions.map((o) => o.labelTl).join('; ') || 'Hindi sinagot';
      return {
        id: q.id,
        question: q.titleEn,
        tagalogQuestion: q.titleTl,
        answer: answerEn,
        tagalogAnswer: answerTl,
        selectedOptionIds: chosenIds,
        role: q.role,
      };
    });

    // 2. Evaluate Clinical Questionnaire Mapping independently
    const mappingResult = evaluateDiseaseMapping(answers);

    // 3. Real ResNet50 Inference via FastAPI Backend
    let aiResult: PredictionResult;
    try {
      setAnalysisError(null);
      const animStartTime = Date.now();
      let prediction: PredictionResult;
      try {
        prediction = await predictSkinCondition(imageUri, referenceImageUri);
      } finally {
        // Ensure the full scanning animation (3600ms) runs completely before revealing result or error
        const elapsed = Date.now() - animStartTime;
        if (elapsed < 3600) {
          await new Promise((resolve) => setTimeout(resolve, 3600 - elapsed));
        }
      }
      aiResult = prediction;
    } catch (err: any) {
      let userMessage = err instanceof AIPredictionError
        ? err.message
        : (err?.message || "We couldn't connect to the AI skin analysis service. Please check your network and try again.");

      if (
        userMessage.includes('CLEARTEXT') ||
        userMessage.includes('UnknownServiceException') ||
        userMessage.includes('Network request failed') ||
        userMessage.includes('failed to connect') ||
        userMessage.includes('Connection refused')
      ) {
        userMessage = "Cannot connect to the AI Backend. Please ensure the Python server is running on port 8000 and your phone is on the same Wi-Fi network (192.168.100.42).";
      }

      setAnalysisError(userMessage);
      setStep('upload');
      setTimeout(() => {
        if (Platform.OS === 'web') {
          try { (window as any)?.alert?.(userMessage); } catch {}
        } else {
          Alert.alert('Analysis Notice', userMessage);
        }
      }, 100);
      return;
    }

    // 4. Derive Primary AI Prediction & Confidence
    const conditionName = aiResult.display_name;
    const conditionGuide = getConditionGuide(conditionName);
    const isCombined = Boolean(aiResult.is_combined && aiResult.combined_evidence_score != null);
    const displayConfidence = isCombined
      ? Math.round(aiResult.combined_evidence_score!)
      : Math.round(aiResult.confidence);

    // 5. Compare AI Prediction and Questionnaire Support independently
    const comparison = compareAIAndQuestionnaire(conditionName, displayConfidence, mappingResult);

    // 6. Extract patient-reported daily life impact from Q15
    const q15Choice = answers.q15?.[0];
    let patientReportedImpact: 'Mild' | 'Moderate' | 'Severe' = 'Mild';
    if (q15Choice === 'q15_opt3' || q15Choice === 'q15_opt4') {
      patientReportedImpact = 'Severe';
    } else if (q15Choice === 'q15_opt2') {
      patientReportedImpact = 'Moderate';
    }

    // 7. Extract body location label from Q7
    const q7Opts = QUESTIONNAIRE_QUESTIONS.find((q) => q.id === 'q7')?.options || [];
    const bodyLocationLabel = (answers.q7 || [])
      .map((id) => q7Opts.find((o) => o.id === id)?.labelEn)
      .filter(Boolean)
      .join(', ') || 'Skin Assessment';

    const condEval = (mappingResult.conditions as any)[conditionName] ||
      Object.values(mappingResult.conditions).find((c: any) =>
        conditionName.toLowerCase().includes(c.condition.toLowerCase())
      );
    const supportingFindings = condEval?.supportingFindings || [];
    const referralSuggested = activeSafetyAlert.level !== 'none';

    const scanResult: ScanResult = {
      id: `scan_${Date.now()}`,
      userId: user?.id ?? 'demo',
      date: new Date().toISOString(),
      imageUri,
      imageUris: [imageUri, referenceImageUri],
      answers: {
        ...answers,
        bodyLocation: bodyLocationLabel,
        questionnaireData: JSON.stringify(questionnaireData),
      } as any,
      condition: conditionName,
      localName: conditionGuide?.filipinoName || 'Taghiyawat',
      confidence: displayConfidence,
      severity: patientReportedImpact === 'Severe' ? 'severe' : patientReportedImpact === 'Moderate' ? 'moderate' : 'mild',
      category: conditionGuide?.category || 'Dermatology',
      description: conditionGuide?.definition || 'A common dermatological condition.',
      symptoms: conditionGuide?.commonSymptoms || [],
      careTips: conditionGuide?.basicCareTips || [],
      referralSuggested,
      referralReason: referralSuggested ? activeSafetyAlert.message : undefined,
      isGovernmentReportable: false,
      isCombined,
      combinedEvidenceScore: isCombined ? aiResult.combined_evidence_score! : undefined,
      patientReportedImpact,
      agreementStatus: comparison.agreementStatus,
      agreementSummary: comparison.summary,
      supportingFindings,
      status: 'completed',
    };

    // Transition to result immediately for responsive UI
    setResult(scanResult);
    setStep('result');

    // Asynchronously sync to Supabase in the background
    if (user) {
      (async () => {
        try {
          await saveScanResult(user.id, scanResult);
          const isDemoAccount = user.email.toLowerCase().endsWith('@dermai.ph');
          const sub = await getUserSubscription(user.id);
          const isPaid = sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1;
          if (!isDemoAccount && !isPaid) {
            await setUserSubscription(user.id, {
              ...(sub ?? { userId: user.id, email: user.email, plan: 'free' as const }),
              scansUsed: (sub?.scansUsed ?? 0) + 1,
            });
          }
          await addAppNotification(user.id, {
            type: 'scan',
            title: 'Scan Complete',
            message: `Your scan result is ready: ${conditionName} (${displayConfidence}% confidence).`,
            userId: user.id,
          });
        } catch (syncErr) {
          console.warn('[Scan] Background sync warning:', syncErr);
        }
      })();
    }
  }

  // --- Welcome ---------------------------------------------------------------
  if (step === 'welcome') {
    const scansLeft = Math.max(0, MAX_FREE_SCANS - scansUsed);
    const limitReached = !isPremium && scansLeft === 0;
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView style={styles.container} contentContainerStyle={styles.welcomeContainer} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatarCircle}>
              <Ionicons name="camera" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.headerWelcome}>AI Assessment</Text>
              <Text style={styles.headerName}>Scan Your Skin</Text>
            </View>
          </View>

          <Text style={styles.welcomeSub}>Get an AI-powered preliminary assessment of your skin condition</Text>

          <StepIndicator currentStep={0} />

          <View style={styles.card}>
            <View style={styles.welcomeIconCircle}>
              <Ionicons name="camera-outline" size={36} color={COLORS.primary} />
            </View>
            <Text style={styles.welcomeCardTitle}>Ready to analyze your skin?</Text>
            <Text style={styles.welcomeCardSub}>
              Answer our 15 clinical pre-screening questions (English &amp; Tagalog), upload clear photos of the affected area,
              and receive an AI assessment with care recommendations.
            </Text>

            {[
              { n: 1, label: 'Answer 15 Questions', desc: 'Tell us about your symptoms & history', color: COLORS.primary },
              { n: 2, label: 'Upload 2 Photos', desc: 'Close-up & wide angle views', color: '#2563eb' },
              { n: 3, label: 'View Result', desc: 'Get your AI diagnosis & care tips', color: '#7c3aed' },
            ].map((s) => (
              <View key={s.n} style={styles.welcomeStep}>
                <View style={[styles.welcomeStepNum, { backgroundColor: s.color }]}>
                  <Text style={styles.welcomeStepNumTxt}>{s.n}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.welcomeStepLabel}>{s.label}</Text>
                  <Text style={styles.welcomeStepDesc}>{s.desc}</Text>
                </View>
              </View>
            ))}

            {!isPremium && (
              <View style={[styles.quotaBanner, limitReached && styles.quotaBannerDanger]}>
                <View style={[styles.quotaIconWrap, { backgroundColor: limitReached ? COLORS.danger + '18' : COLORS.primary + '18' }]}>
                  <Ionicons
                    name={limitReached ? 'lock-closed' : 'camera-outline'}
                    size={17}
                    color={limitReached ? COLORS.danger : COLORS.primary}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.quotaTitle, limitReached && { color: COLORS.danger }]}>
                    {limitReached ? 'Free scans used' : `Free Plan: ${MAX_FREE_SCANS} Scans`}
                  </Text>
                  <Text style={styles.quotaSub}>
                    {limitReached
                      ? 'Upgrade to Premium for unlimited scans'
                      : `You have ${scansLeft} free skin scan${scansLeft !== 1 ? 's' : ''}. Upgrade for unlimited access.`}
                  </Text>
                </View>
                {limitReached && (
                  <TouchableOpacity
                    style={styles.quotaUpgradeBtn}
                    onPress={() => router.push('/(app)/subscription')}
                  >
                    <Text style={styles.quotaUpgradeTxt}>Upgrade</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {isPremium && (
              <View style={styles.quotaBannerPremium}>
                <View style={[styles.quotaIconWrap, { backgroundColor: COLORS.primary + '18' }]}>
                  <Ionicons name="star" size={15} color={COLORS.primary} />
                </View>
                <Text style={[styles.quotaTitle, { marginLeft: 10, color: COLORS.primary }]}>Premium — Unlimited Scans</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.ctaBtn, limitReached && styles.ctaBtnOutline]}
              onPress={limitReached
                ? () => router.push('/(app)/subscription')
                : async () => {
                    const can = await checkCanScan();
                    if (!can) { router.push('/(app)/subscription'); return; }
                    setStep('questionnaire');
                  }}
            >
              <Text style={[styles.ctaBtnTxt, limitReached && { color: COLORS.primary }]}>
                {limitReached ? 'Upgrade to Continue' : 'Begin Questionnaire'}
              </Text>
            </TouchableOpacity>

            <View style={styles.disclaimerRow}>
              <Ionicons name="warning-outline" size={13} color={COLORS.warning} />
              <Text style={styles.disclaimerTxt}>
                {' '}DermAI provides preliminary assessments only. Always consult a licensed dermatologist.
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // --- Questionnaire Step (One at a time OR Review Screen) ---------------------
  if (step === 'questionnaire') {
    // ── REVIEW SCREEN (When isReviewing === true) ──
    if (isReviewing) {
      return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
          <View style={styles.container}>
            <StepIndicator currentStep={1} />
            <ScrollView contentContainerStyle={styles.pageContainer} showsVerticalScrollIndicator={false}>
              <View style={styles.card}>
                <View style={styles.reviewHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pageTitle}>Review Your Answers</Text>
                    <Text style={styles.reviewSubtitle}>
                      Suriin ang iyong mga sagot bago magpatuloy sa pag-upload ng larawan.
                    </Text>
                  </View>
                  <View style={styles.completedBadge}>
                    <Ionicons name="checkmark-circle" size={13} color="#059669" />
                    <Text style={styles.completedBadgeTxt}>15 of 15 Done</Text>
                  </View>
                </View>

                {/* Safety Warning Alert Banner if Q14 triggered */}
                {activeSafetyAlert.level !== 'none' && (
                  <View
                    style={[
                      styles.safetyAlertBanner,
                      activeSafetyAlert.level === 'emergency'
                        ? styles.safetyAlertEmergency
                        : styles.safetyAlertUrgent,
                    ]}
                  >
                    <Ionicons
                      name="shield-checkmark"
                      size={20}
                      color={activeSafetyAlert.level === 'emergency' ? '#e11d48' : '#b45309'}
                      style={{ marginTop: 2 }}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        style={[
                          styles.safetyAlertTitle,
                          activeSafetyAlert.level === 'emergency'
                            ? { color: '#9f1239' }
                            : { color: '#92400e' },
                        ]}
                      >
                        {activeSafetyAlert.title}
                      </Text>
                      <Text
                        style={[
                          styles.safetyAlertMsg,
                          activeSafetyAlert.level === 'emergency'
                            ? { color: '#be123c' }
                            : { color: '#78350f' },
                        ]}
                      >
                        {activeSafetyAlert.message}
                      </Text>
                      <Text
                        style={[
                          styles.safetyAlertAction,
                          activeSafetyAlert.level === 'emergency'
                            ? { color: '#9f1239' }
                            : { color: '#92400e' },
                        ]}
                      >
                        {activeSafetyAlert.actionRequired}
                      </Text>
                    </View>
                  </View>
                )}

                {/* List of 15 questions and user answers */}
                <View style={styles.reviewList}>
                  {QUESTIONNAIRE_QUESTIONS.map((q, idx) => {
                    const chosenIds = answers[q.id] || [];
                    const chosenOptions = q.options.filter((o) => chosenIds.includes(o.id));

                    return (
                      <View key={q.id} style={styles.reviewItemCard}>
                        <View style={styles.reviewItemHeader}>
                          <Text style={styles.reviewItemNum}>QUESTION {q.number}</Text>
                          <TouchableOpacity
                            style={styles.reviewEditBtn}
                            onPress={() => jumpToQuestion(idx)}
                          >
                            <Ionicons name="pencil" size={12} color={COLORS.primary} />
                            <Text style={styles.reviewEditBtnTxt}>Edit</Text>
                          </TouchableOpacity>
                        </View>

                        <Text style={styles.reviewItemTitleEn} numberOfLines={2}>
                          {q.titleEn}
                        </Text>
                        <Text style={styles.reviewItemTitleTl} numberOfLines={2}>
                          {q.titleTl}
                        </Text>

                        <View style={styles.reviewPillContainer}>
                          {chosenOptions.length > 0 ? (
                            chosenOptions.map((opt) => (
                              <View key={opt.id} style={styles.reviewAnswerPill}>
                                <Text style={styles.reviewAnswerPillEn}>{opt.labelEn}</Text>
                                <Text style={styles.reviewAnswerPillTl}>({opt.labelTl})</Text>
                              </View>
                            ))
                          ) : (
                            <Text style={styles.reviewUnansweredTxt}>Not answered</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Action buttons */}
                <View style={styles.reviewBtnRow}>
                  <TouchableOpacity
                    style={styles.reviewBackBtn}
                    onPress={goPrevQuestion}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="arrow-back" size={16} color={COLORS.text} />
                    <Text style={styles.reviewBackBtnTxt}>Back</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.reviewProceedBtn}
                    onPress={() => {
                      setIsReviewing(false);
                      setStep('upload');
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.reviewProceedBtnTxt} numberOfLines={1}>Proceed to Photos</Text>
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      );
    }

    // ── ACTIVE SINGLE QUESTION VIEW ──
    const progressPct = ((qIndex + 1) / QUESTIONNAIRE_QUESTIONS.length) * 100;

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.container}>
          <StepIndicator currentStep={1} />
          <ScrollView contentContainerStyle={styles.pageContainer} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>

              {/* Progress & counter badge */}
              <View style={styles.qHeaderRow}>
                <View style={styles.qBadgeGroup}>
                  <View style={styles.qCounterBadge}>
                    <Text style={styles.qCounterBadgeTxt}>
                      Question {qIndex + 1} of {QUESTIONNAIRE_QUESTIONS.length}
                    </Text>
                  </View>
                  {currentQuestion.isMultiSelect && (
                    <View style={styles.qMultiBadge}>
                      <Text style={styles.qMultiBadgeTxt}>Multi-select</Text>
                    </View>
                  )}
                </View>

                {/* Top smooth progress bar */}
                <View style={styles.qProgressBarBg}>
                  <View style={[styles.qProgressBarFill, { width: `${progressPct}%` }]} />
                </View>
              </View>

              {/* Bilingual Question Titles */}
              <View style={styles.qTitleBlock}>
                <Text style={styles.qTitleEn}>{currentQuestion.titleEn}</Text>
                <Text style={styles.qTitleTl}>{currentQuestion.titleTl}</Text>
                {currentQuestion.helperEn && (
                  <View style={styles.qHelperRow}>
                    <Ionicons name="information-circle-outline" size={14} color="#64748b" />
                    <Text style={styles.qHelperTxt}>{currentQuestion.helperEn}</Text>
                  </View>
                )}
              </View>

              {/* Options */}
              <View style={styles.qOptionsContainer}>
                {currentQuestion.options.map((opt) => {
                  const isSelected = currentSelections.includes(opt.id);
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.qOptionBtn,
                        isSelected && styles.qOptionBtnSelected,
                      ]}
                      onPress={() => selectOption(opt.id)}
                      activeOpacity={0.8}
                    >
                      {/* Checkbox (multi) or Radio (single) Indicator */}
                      <View
                        style={[
                          currentQuestion.isMultiSelect
                            ? styles.qCheckIndicator
                            : styles.qRadioIndicator,
                          isSelected && (
                            currentQuestion.isMultiSelect
                              ? styles.qCheckIndicatorSelected
                              : styles.qRadioIndicatorSelected
                          ),
                        ]}
                      >
                        {isSelected && (
                          currentQuestion.isMultiSelect ? (
                            <Ionicons name="checkmark" size={13} color="#fff" />
                          ) : (
                            <View style={styles.qRadioInnerDot} />
                          )
                        )}
                      </View>

                      {/* Bilingual Option Text */}
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.qOptionLabelEn,
                            isSelected && styles.qOptionLabelEnSelected,
                          ]}
                        >
                          {opt.labelEn}
                        </Text>
                        <Text
                          style={[
                            styles.qOptionLabelTl,
                            isSelected && styles.qOptionLabelTlSelected,
                          ]}
                        >
                          {opt.labelTl}
                        </Text>
                      </View>

                      {/* Warning flag badge for Q14 */}
                      {opt.safetyWarning && (
                        <View
                          style={[
                            styles.optWarningTag,
                            opt.safetyWarning === 'emergency'
                              ? styles.optWarningEmergency
                              : styles.optWarningUrgent,
                          ]}
                        >
                          <Ionicons
                            name="warning-outline"
                            size={11}
                            color={opt.safetyWarning === 'emergency' ? '#be123c' : '#b45309'}
                          />
                          <Text
                            style={[
                              styles.optWarningTagTxt,
                              opt.safetyWarning === 'emergency'
                                ? { color: '#be123c' }
                                : { color: '#b45309' },
                            ]}
                          >
                            {opt.safetyWarning === 'emergency' ? 'EMERGENCY' : 'URGENT'}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Navigation buttons */}
              <View style={styles.qNavRow}>
                <TouchableOpacity
                  style={styles.qNavBackBtn}
                  onPress={goPrevQuestion}
                >
                  <Ionicons name="arrow-back" size={16} color={COLORS.text} />
                  <Text style={styles.qNavBackTxt}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.qNavNextBtn,
                    !hasAnsweredCurrent && styles.qNavNextBtnDisabled,
                  ]}
                  disabled={!hasAnsweredCurrent}
                  onPress={goNextQuestion}
                >
                  <Text style={styles.qNavNextTxt} numberOfLines={1}>
                    {qIndex < QUESTIONNAIRE_QUESTIONS.length - 1
                      ? 'Next Question'
                      : 'Review All 15 Answers'}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </TouchableOpacity>
              </View>

            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  // --- Upload -----------------------------------------------------------------
  if (step === 'upload') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.container}>
          <StepIndicator currentStep={2} />
          <ScrollView contentContainerStyle={styles.pageContainer} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.backRow}
                onPress={() => {
                  setStep('questionnaire');
                  setIsReviewing(true);
                }}
              >
                <Ionicons name="arrow-back" size={16} color={COLORS.textSecondary} />
                <Text style={styles.backTxt}> Review Answers</Text>
              </TouchableOpacity>
              <Text style={styles.pageTitle}>Upload Assessment Photos</Text>
              <Text style={styles.uploadSubtitle}>
                Please provide both a close-up and a wide-view photo for accurate AI skin comparison.
              </Text>

              {analysisError ? (
                <View style={styles.analysisErrorBanner}>
                  <Ionicons name="alert-circle" size={20} color="#dc2626" />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.analysisErrorTitle}>Photo Analysis Notice</Text>
                    <Text style={styles.analysisErrorText}>{analysisError}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setAnalysisError(null)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={18} color="#dc2626" />
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Photo 1: Close-up */}
              <View style={styles.uploadSlotContainer}>
                <View style={styles.slotHeaderRow}>
                  <View style={styles.slotTitleCol}>
                    <Text style={styles.uploadSlotTitle}>1. Close-up View</Text>
                    <Text style={styles.uploadSlotSubtitle}>Malapitang Kuha · Skin Lesion</Text>
                  </View>
                  {imageUri ? (
                    <View style={styles.slotReadyBadge}>
                      <Ionicons name="checkmark-circle" size={13} color="#059669" />
                      <Text style={styles.slotReadyBadgeTxt}>Ready</Text>
                    </View>
                  ) : (
                    <View style={styles.slotRequiredBadge}>
                      <Text style={styles.slotRequiredTxt}>Required</Text>
                    </View>
                  )}
                </View>

                {imageUri ? (
                  <View style={styles.previewContainer}>
                    <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="cover" />
                    <View style={styles.previewActions}>
                      <TouchableOpacity
                        style={styles.previewBtnChange}
                        onPress={() => promptImageSource('primary')}
                      >
                        <Ionicons name="camera-reverse-outline" size={13} color="#fff" />
                        <Text style={styles.previewBtnChangeTxt}>Change</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.previewBtnRemove}
                        onPress={() => setImageUri(null)}
                      >
                        <Ionicons name="trash-outline" size={13} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.uploadCard}>
                    <View style={styles.uploadCardIconWrap}>
                      <Ionicons name="camera-outline" size={26} color={COLORS.primary} />
                    </View>
                    <Text style={styles.uploadCardTitle}>Primary Close-up of Skin Lesion</Text>
                    <Text style={styles.uploadCardSub}>Sharp focus under good lighting</Text>
                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity
                        style={styles.cardBtnPrimary}
                        onPress={() => setLiveCameraSlot('primary')}
                      >
                        <Ionicons name="camera" size={15} color="#fff" />
                        <Text style={styles.cardBtnPrimaryTxt}>Live Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.cardBtnSecondary}
                        onPress={() => pickImage('primary', false)}
                      >
                        <Ionicons name="images-outline" size={15} color="#334155" />
                        <Text style={styles.cardBtnSecondaryTxt}>Gallery</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* Photo 2: Wide-view */}
              <View style={styles.uploadSlotContainer}>
                <View style={styles.slotHeaderRow}>
                  <View style={styles.slotTitleCol}>
                    <Text style={styles.uploadSlotTitle}>2. Wide-view / Context</Text>
                    <Text style={styles.uploadSlotSubtitle}>Malawakang Kuha · Surrounding Area</Text>
                  </View>
                  {referenceImageUri ? (
                    <View style={styles.slotReadyBadge}>
                      <Ionicons name="checkmark-circle" size={13} color="#059669" />
                      <Text style={styles.slotReadyBadgeTxt}>Ready</Text>
                    </View>
                  ) : (
                    <View style={styles.slotRequiredBadge}>
                      <Text style={styles.slotRequiredTxt}>Required</Text>
                    </View>
                  )}
                </View>

                {referenceImageUri ? (
                  <View style={styles.previewContainer}>
                    <Image source={{ uri: referenceImageUri }} style={styles.previewImage} resizeMode="cover" />
                    <View style={styles.previewActions}>
                      <TouchableOpacity
                        style={styles.previewBtnChange}
                        onPress={() => promptImageSource('reference')}
                      >
                        <Ionicons name="camera-reverse-outline" size={13} color="#fff" />
                        <Text style={styles.previewBtnChangeTxt}>Change</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.previewBtnRemove}
                        onPress={() => setReferenceImageUri(null)}
                      >
                        <Ionicons name="trash-outline" size={13} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.uploadCard}>
                    <View style={styles.uploadCardIconWrap}>
                      <Ionicons name="image-outline" size={26} color={COLORS.primary} />
                    </View>
                    <Text style={styles.uploadCardTitle}>Surrounding Area & Context</Text>
                    <Text style={styles.uploadCardSub}>Shows distribution around the skin lesion</Text>
                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity
                        style={styles.cardBtnPrimary}
                        onPress={() => setLiveCameraSlot('reference')}
                      >
                        <Ionicons name="camera" size={15} color="#fff" />
                        <Text style={styles.cardBtnPrimaryTxt}>Live Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.cardBtnSecondary}
                        onPress={() => pickImage('reference', false)}
                      >
                        <Ionicons name="images-outline" size={15} color="#334155" />
                        <Text style={styles.cardBtnSecondaryTxt}>Gallery</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              <View style={styles.guidelinesBox}>
                <Text style={styles.guidelinesTitle}>Photo Quality Guidelines</Text>
                {[
                  { icon: 'sunny-outline' as const, text: 'Use bright, natural daylight whenever possible' },
                  { icon: 'search-outline' as const, text: 'Ensure the camera is sharply focused, not blurry' },
                  { icon: 'color-wand-outline' as const, text: 'No camera filters, makeup, or digital effects' },
                ].map((g) => (
                  <View key={g.text} style={styles.guidelineRow}>
                    <Ionicons name={g.icon} size={14} color={COLORS.textSecondary} />
                    <Text style={styles.guidelineTxt}> {g.text}</Text>
                  </View>
                ))}
              </View>

              {!isPremium && (
                <View style={styles.quotaBanner}>
                  <View style={[styles.quotaIconWrap, { backgroundColor: '#F5F6FA' }]}>
                    <Ionicons name="lock-closed-outline" size={16} color={COLORS.textSecondary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.quotaTitle}>Free Plan: {MAX_FREE_SCANS} Scans</Text>
                    <Text style={styles.quotaSub}>
                      You have {Math.max(0, MAX_FREE_SCANS - scansUsed)} free skin scan{Math.max(0, MAX_FREE_SCANS - scansUsed) !== 1 ? 's' : ''}. Upgrade for unlimited access.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.quotaUpgradeBtn}
                    onPress={() => router.push('/(app)/subscription')}
                  >
                    <Text style={styles.quotaUpgradeTxt}>Upgrade</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[styles.ctaBtn, (!imageUri || !referenceImageUri) && styles.ctaBtnDisabled]}
                disabled={!imageUri || !referenceImageUri}
                onPress={runAnalysis}
              >
                <Text style={styles.ctaBtnTxt}>Analyze Skin Condition</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        <LiveCameraModal
          visible={liveCameraSlot !== null}
          title={liveCameraSlot === 'primary' ? 'Photo 1 — Close-Up View' : 'Photo 2 — Wide-View Area'}
          subtitle={
            liveCameraSlot === 'primary'
              ? 'Center the skin lesion inside the frame'
              : 'Capture the affected skin with surrounding context'
          }
          onClose={() => setLiveCameraSlot(null)}
          onCapture={(uri) => {
            if (liveCameraSlot === 'primary') {
              setImageUri(uri);
            } else if (liveCameraSlot === 'reference') {
              setReferenceImageUri(uri);
            }
            setLiveCameraSlot(null);
          }}
        />
      </SafeAreaView>
    );
  }

  // --- Analyzing --------------------------------------------------------------
  if (step === 'analyzing') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.container}>
          <StepIndicator currentStep={2} />
          <AIScanningAnimationView imageUri={imageUri} referenceImageUri={referenceImageUri} />
        </View>
      </SafeAreaView>
    );
  }

  // --- Result -----------------------------------------------------------------
  if (step === 'result' && result) {
    return <ResultScreen result={result} onReset={reset} onFindClinic={() => router.push('/(app)/clinics')} />;
  }

  return null;
}

// --- Result screen ------------------------------------------------------------

function ResultScreen({
  result,
  onReset,
  onFindClinic,
}: {
  result: ScanResult;
  onReset: () => void;
  onFindClinic: () => void;
}) {
  const guide = getConditionGuide(result.condition);
  const [realClinics, setRealClinics] = useState<ClinicRecord[]>([]);

  useEffect(() => {
    getClinics().then(setRealClinics);
  }, []);

  const verifiedClinics = (realClinics.length > 0 ? realClinics : SAMPLE_CLINICS)
    .filter((c) => c.verified)
    .slice(0, 2);

  const isAligned = result.agreementStatus === 'aligned';
  const isCombined = result.isCombined;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        <StepIndicator currentStep={3} />
        <ScrollView contentContainerStyle={styles.pageContainer} showsVerticalScrollIndicator={false}>

          <View style={styles.webResultCard}>
            {/* Header Badges: AI-generated result & Daily-life impact */}
            <View style={styles.webHeaderBadgesRow}>
              <View style={styles.webAiPill}>
                <Ionicons name="sparkles" size={13} color={COLORS.primary} />
                <Text style={styles.webAiPillTxt}>AI-generated preliminary result</Text>
              </View>
              {result.patientReportedImpact ? (
                <View style={styles.webImpactPill}>
                  <Text style={styles.webImpactPillTxt}>
                    Reported Daily-Life Impact: <Text style={{ fontWeight: '700' }}>{result.patientReportedImpact}</Text>
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Condition Title & Tagalog Subtitle */}
            <Text style={styles.webConditionTitle}>Possible Condition: {result.condition}</Text>
            {result.localName ? (
              <Text style={styles.webConditionSubtitle}>Lokal na tawag: {result.localName}</Text>
            ) : null}

            {/* Confidence Score Bar */}
            <View style={styles.webConfidenceSection}>
              <View style={styles.webConfHeaderRow}>
                <Text style={styles.webConfTitle}>
                  {isCombined
                    ? 'Combined Image Evidence (70% Close-Up + 30% Wide-View)'
                    : 'Image Model Confidence (ResNet50)'}
                </Text>
                <Text style={styles.webConfValue}>{result.confidence}%</Text>
              </View>
              <Text style={styles.webConfSub}>
                {isCombined
                  ? 'Derived from multi-view fusion: 70% primary lesion morphology + 30% anatomical distribution.'
                  : 'Solely based on image inference; not altered by questionnaire answers.'}
              </Text>
              <View style={styles.webConfBarTrack}>
                <View style={[styles.webConfBarFill, { width: `${Math.min(100, Math.max(5, result.confidence))}%` }]} />
              </View>
            </View>

            {/* Supportive Alignment Card */}
            <View style={[styles.webAlignCard, isAligned ? styles.webAlignCardGreen : styles.webAlignCardAmber]}>
              <View style={styles.webAlignHeaderRow}>
                <Ionicons
                  name={isAligned ? 'checkmark-circle' : 'information-circle'}
                  size={18}
                  color={isAligned ? '#059669' : '#d97706'}
                />
                <Text style={[styles.webAlignTitle, { color: isAligned ? '#065f46' : '#92400e' }]}>
                  {isAligned
                    ? 'Supportive Alignment Between Photo & Questionnaire'
                    : 'Contextual Variation Between Photo & Questionnaire'}
                </Text>
              </View>
              <Text style={[styles.webAlignBody, { color: isAligned ? '#047857' : '#b45309' }]}>
                {result.agreementSummary ||
                  'Clinical presentation and patient-reported symptoms were evaluated independently to inform care guidance.'}
              </Text>
            </View>

            {/* Questionnaire Evidence Support Card */}
            <View style={styles.webEvidenceCard}>
              <View style={styles.webEvidenceHeaderRow}>
                <Text style={styles.webEvidenceTitle}>Questionnaire Evidence Support</Text>
                <View style={[styles.webSupportPill, !isAligned && styles.webSupportPillAmber]}>
                  <Text style={[styles.webSupportPillTxt, !isAligned && styles.webSupportPillTxtAmber]}>
                    {isAligned ? 'Strong support' : 'Limited support'}
                  </Text>
                </View>
              </View>
              <Text style={styles.webEvidenceSubtitle}>
                Rule-based screening grounded in clinical practice guidelines:
              </Text>

              <View style={styles.webFindingsBox}>
                <Text style={styles.webFindingsHeader}>
                  {isAligned ? 'Key Supporting Questionnaire Findings' : 'Reported Symptoms Assessment'}
                </Text>
                {result.supportingFindings && result.supportingFindings.length > 0 ? (
                  result.supportingFindings.map((finding, idx) => (
                    <View key={idx} style={styles.webFindingRow}>
                      <Ionicons name="checkmark-circle" size={14} color="#059669" style={{ marginTop: 2, marginRight: 6 }} />
                      <Text style={styles.webFindingTxt}>{finding}</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.webFindingRow}>
                    <Ionicons name="information-circle" size={14} color="#d97706" style={{ marginTop: 2, marginRight: 6 }} />
                    <Text style={[styles.webFindingTxt, { color: '#92400e' }]}>
                      Patient-reported questionnaire symptoms provide limited specific overlap with {result.condition}. In-person clinical dermatological evaluation recommended.
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Uploaded Photos Strip */}
            {result.imageUris && result.imageUris.length > 0 ? (
              <View style={styles.webPhotosSection}>
                <Text style={styles.webPhotosSectionTitle}>Uploaded Photos & AI Evidence</Text>
                <View style={styles.webPhotosRow}>
                  {result.imageUris[0] ? (
                    <View style={styles.webPhotoCol}>
                      <Image source={{ uri: result.imageUris[0] }} style={styles.webPhotoImg} resizeMode="cover" />
                      <Text style={styles.webPhotoLabel}>CLOSE-UP (PRIMARY)</Text>
                      <View style={styles.photoStatusBadgePrimary}>
                        <Ionicons name="scan-circle" size={11} color="#059669" />
                        <Text style={styles.photoStatusTextPrimary}>Primary Lesion Analyzed</Text>
                      </View>
                    </View>
                  ) : null}
                  {result.imageUris[1] ? (
                    <View style={styles.webPhotoCol}>
                      <Image source={{ uri: result.imageUris[1] }} style={styles.webPhotoImg} resizeMode="cover" />
                      <Text style={styles.webPhotoLabel}>WIDE-VIEW (CONTEXT)</Text>
                      {result.isCombined ? (
                        <View style={styles.photoStatusBadgeCombined}>
                          <Ionicons name="checkmark-circle" size={11} color="#2563eb" />
                          <Text style={styles.photoStatusTextCombined}>Context Verified (30%)</Text>
                        </View>
                      ) : (
                        <View style={styles.photoStatusBadgeExcluded}>
                          <Ionicons name="alert-circle" size={11} color="#b45309" />
                          <Text style={styles.photoStatusTextExcluded}>Excluded: Inconclusive Context</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Clinical Condition Guide Sections */}
            {guide ? (
              <View style={styles.webGuideSection}>
                {/* What is it? */}
                <Text style={styles.webSectionHeading}>What is it? / Ano ito?</Text>
                <Text style={styles.webSectionBody}>{guide.definition}</Text>

                {/* Common Symptoms */}
                <Text style={styles.webSectionHeading}>Common Symptoms / Karaniwang Sintomas</Text>
                {guide.commonSymptoms.map((sym, i) => (
                  <View key={i} style={styles.webBulletRow}>
                    <View style={styles.webBulletDot} />
                    <Text style={styles.webBulletTxt}>{sym}</Text>
                  </View>
                ))}

                {/* Who does it affect? */}
                <View style={styles.webCalloutBox}>
                  <View style={styles.webCalloutHeaderRow}>
                    <Ionicons name="people-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.webCalloutTitle}>Who does it affect? / Sino ang naaapektuhan?</Text>
                  </View>
                  <Text style={styles.webCalloutBody}>{guide.whoIsAffected}</Text>
                </View>

                {/* Evidence-Based Basic Care Tips */}
                <Text style={styles.webSectionHeading}>Evidence-Based Basic Care Tips</Text>
                {guide.basicCareTips.map((tip, i) => (
                  <View key={i} style={styles.webCareTipRow}>
                    <Ionicons name="checkmark-circle-outline" size={16} color="#059669" style={{ marginTop: 2, marginRight: 8 }} />
                    <Text style={styles.webCareTipTxt}>{tip}</Text>
                  </View>
                ))}

                {/* When to See a Doctor */}
                <View style={styles.webDocBox}>
                  <View style={styles.webDocHeaderRow}>
                    <Ionicons name="medkit-outline" size={16} color="#b45309" />
                    <Text style={styles.webDocTitle}>When to See a Doctor / Kailan Dapat Magpatingin sa Doktor</Text>
                  </View>
                  <Text style={styles.webDocBody}>{guide.whenToSeeDoctor}</Text>
                </View>

                {/* Verified Medical Sources */}
                <View style={styles.webCitationsBox}>
                  <Text style={styles.webCitationsTitle}>VERIFIED MEDICAL SOURCES & CLINICAL CITATIONS:</Text>
                  <View style={styles.webCitationsGrid}>
                    <View style={styles.webCitationItem}>
                      <Text style={styles.webCitationTxt}>American Academy of Dermatology (AAD)</Text>
                    </View>
                    <View style={styles.webCitationItem}>
                      <Text style={styles.webCitationTxt}>Cleveland Clinic Dermatology</Text>
                    </View>
                    <View style={styles.webCitationItem}>
                      <Text style={styles.webCitationTxt}>DermNet NZ (Dermatological Society)</Text>
                    </View>
                  </View>
                </View>

                {/* Medical Disclaimer */}
                <View style={styles.webDisclaimerBox}>
                  <View style={styles.webDisclaimerHeaderRow}>
                    <Ionicons name="warning-outline" size={16} color="#e11d48" />
                    <Text style={styles.webDisclaimerTitle}>Medical Disclaimer</Text>
                  </View>
                  <Text style={styles.webDisclaimerBody}>
                    This AI assessment and rule-based questionnaire mapping are intended for educational and pre-screening purposes only. It is NOT a clinical diagnosis and cannot replace an in-person examination by a licensed medical dermatologist.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Action Buttons */}
            <View style={styles.webActionButtonsRow}>
              <TouchableOpacity style={styles.webBtnOutline} onPress={onReset}>
                <Text style={styles.webBtnOutlineTxt}>Scan Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.webBtnFilled} onPress={onFindClinic}>
                <Text style={styles.webBtnFilledTxt}>Find a Clinic</Text>
              </TouchableOpacity>
            </View>

          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// --- Styles -------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    backgroundColor: '#fff',
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  welcomeSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: '#fff',
    lineHeight: 19,
  },

  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  stepIndicatorItem: { alignItems: 'center', flex: 1 },
  stepIndicatorLabelRow: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepConnector: { flex: 1, height: 2, backgroundColor: '#EDEFF3', marginHorizontal: 2 },
  stepConnectorActive: { backgroundColor: COLORS.primary },
  stepCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#F5F6FA',
    alignItems: 'center', justifyContent: 'center',
  },
  stepCircleActive: { backgroundColor: COLORS.primary },
  stepCircleDone: { backgroundColor: COLORS.primary },
  stepCircleTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  stepIndicatorLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 5, fontWeight: '500', textAlign: 'center' },
  stepIndicatorLabelActive: { color: COLORS.primary, fontWeight: '700' },

  welcomeContainer: { paddingBottom: 32 },
  welcomeIconCircle: {
    width: 68, height: 68, borderRadius: 20,
    backgroundColor: '#fce7f3',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 14,
  },
  welcomeCardTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 8 },
  welcomeCardSub: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  welcomeStep: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  welcomeStepNum: {
    width: 28, height: 28, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  welcomeStepNumTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  welcomeStepLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  welcomeStepDesc: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  card: {
    backgroundColor: '#fff', borderRadius: 20,
    marginHorizontal: 16, marginTop: 14,
    padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#f1f5f9',
  },
  pageContainer: { paddingBottom: 20 },
  pageTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backTxt: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' },

  // ── Questionnaire Active Question Styles ──
  qHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  qBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  qCounterBadge: {
    backgroundColor: '#fdf2f8',
    borderColor: '#fce7f3',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  qCounterBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  qMultiBadge: {
    backgroundColor: '#eff6ff',
    borderColor: '#dbeafe',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  qMultiBadgeTxt: {
    fontSize: 10,
    fontWeight: '600',
    color: '#2563eb',
  },
  qProgressBarBg: {
    width: 90,
    height: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  qProgressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  qTitleBlock: {
    marginBottom: 16,
  },
  qTitleEn: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 24,
  },
  qTitleTl: {
    fontSize: 13,
    fontWeight: '500',
    fontStyle: 'italic',
    color: '#64748b',
    marginTop: 3,
    lineHeight: 18,
  },
  qHelperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  qHelperTxt: {
    fontSize: 11,
    color: '#64748b',
    flex: 1,
  },
  qOptionsContainer: {
    gap: 10,
    marginBottom: 20,
  },
  qOptionBtn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  qOptionBtnSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#fdf2f8',
  },
  qRadioIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  qRadioIndicatorSelected: {
    borderColor: COLORS.primary,
  },
  qRadioInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  qCheckIndicator: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  qCheckIndicatorSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  qOptionLabelEn: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    lineHeight: 20,
  },
  qOptionLabelEnSelected: {
    color: '#831843',
  },
  qOptionLabelTl: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    lineHeight: 16,
  },
  qOptionLabelTlSelected: {
    color: '#9d174d',
  },
  optWarningTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'center',
  },
  optWarningEmergency: {
    backgroundColor: '#ffe4e6',
  },
  optWarningUrgent: {
    backgroundColor: '#fef3c7',
  },
  optWarningTagTxt: {
    fontSize: 9,
    fontWeight: '800',
  },

  qNavRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  qNavBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  qNavBackTxt: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  qNavNextBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
    minWidth: 0,
  },
  qNavNextBtnDisabled: {
    backgroundColor: '#cbd5e1',
    shadowOpacity: 0,
    elevation: 0,
  },
  qNavNextTxt: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#fff',
    flexShrink: 1,
  },

  // ── Review Screen Styles ──
  reviewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 14,
  },
  reviewSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
    marginTop: 2,
    lineHeight: 16,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  completedBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },

  safetyAlertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  safetyAlertEmergency: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  safetyAlertUrgent: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  safetyAlertTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 3,
  },
  safetyAlertMsg: {
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 4,
  },
  safetyAlertAction: {
    fontSize: 11,
    fontWeight: '700',
  },

  reviewList: {
    gap: 10,
    marginBottom: 18,
  },
  reviewItemCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  reviewItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  reviewItemNum: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  reviewEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#fdf2f8',
  },
  reviewEditBtnTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  reviewItemTitleEn: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    lineHeight: 18,
  },
  reviewItemTitleTl: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#64748b',
    marginTop: 2,
    marginBottom: 8,
  },
  reviewPillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reviewAnswerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reviewAnswerPillEn: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  reviewAnswerPillTl: {
    fontSize: 10,
    color: '#94a3b8',
  },
  reviewUnansweredTxt: {
    fontSize: 12,
    fontStyle: 'italic',
    color: COLORS.danger,
  },

  reviewBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    width: '100%',
  },
  reviewBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    flexShrink: 0,
  },
  reviewBackBtnTxt: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  reviewProceedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
    minWidth: 0,
  },
  reviewProceedBtnTxt: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#fff',
    flexShrink: 1,
  },

  // ── Upload & Photo Selection ──
  uploadSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  uploadSlotContainer: {
    marginBottom: 14,
  },
  slotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  slotTitleCol: {
    flex: 1,
    paddingRight: 6,
  },
  uploadSlotTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 18,
  },
  uploadSlotSubtitle: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 15,
  },
  slotReadyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    flexShrink: 0,
    marginTop: 1,
  },
  slotReadyBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  slotRequiredBadge: {
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fce7f3',
    flexShrink: 0,
    marginTop: 1,
  },
  slotRequiredTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  uploadCard: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  uploadCardIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  uploadCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  uploadCardSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: 14,
    textAlign: 'center',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  cardBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  cardBtnPrimaryTxt: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  cardBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  cardBtnSecondaryTxt: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  previewContainer: {
    height: 170,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#0f172a',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewActions: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewBtnChange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  previewBtnChangeTxt: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  previewBtnRemove: {
    backgroundColor: 'rgba(225, 29, 72, 0.85)',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidelinesBox: {
    backgroundColor: '#F8FAFC', borderRadius: 16,
    padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#f1f5f9',
  },
  guidelinesTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  guidelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 7, gap: 8 },
  guidelineTxt: { fontSize: 12, color: COLORS.text, flex: 1 },

  quotaIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  quotaBanner: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, padding: 14, marginBottom: 14,
    backgroundColor: '#F5F6FA',
  },
  quotaBannerDanger: { backgroundColor: COLORS.danger + '12' },
  quotaBannerPremium: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fce7f3', borderRadius: 16,
    padding: 12, marginVertical: 14,
  },
  quotaTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  quotaSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, lineHeight: 16 },
  quotaUpgradeBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  quotaUpgradeTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },

  ctaBtn: {
    backgroundColor: COLORS.primary, borderRadius: 16,
    paddingVertical: 15, alignItems: 'center',
    marginTop: 8,
    shadowColor: COLORS.primary, shadowOpacity: 0.22,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  ctaBtnOutline: {
    backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.primary,
    shadowOpacity: 0,
  },
  ctaBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  ctaBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 },
  disclaimerTxt: { fontSize: 11, color: COLORS.textSecondary, flex: 1, lineHeight: 17 },

  // ── Analyzing Screen ──
  analyzingContainer: { flex: 1, justifyContent: 'center', paddingBottom: 60 },
  analyzingIconCircle: {
    width: 68, height: 68, borderRadius: 20,
    backgroundColor: '#fce7f3',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 16,
  },
  analyzingTitle: { fontSize: 19, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 8 },
  analyzingSub: { fontSize: 13, color: COLORS.primary, textAlign: 'center', marginBottom: 20 },
  analyzeBarBg: { height: 6, backgroundColor: '#fce7f3', borderRadius: 3, overflow: 'hidden' },
  analysisErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    marginBottom: 8,
  },
  analysisErrorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 2,
  },
  analysisErrorText: {
    fontSize: 12,
    color: '#b91c1c',
    lineHeight: 17,
  },
  analyzeBarFill: { height: 6, width: '60%', backgroundColor: COLORS.primary, borderRadius: 3 },

  // ── Results Screen ──
  comparisonStrip: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  comparisonPhotoWrap: {
    flex: 1,
  },
  comparisonPhoto: {
    width: '100%',
    height: 120,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
  },
  comparisonPhotoLabel: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  categoryBadge: {
    alignSelf: 'flex-start', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10,
  },
  categoryBadgeTxt: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  resultConditionName: { fontSize: 21, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  resultLocalName: { fontSize: 13, color: COLORS.primary, marginBottom: 16 },
  resultSectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  confBarBg: { flex: 1, height: 8, backgroundColor: '#fce7f3', borderRadius: 4, overflow: 'hidden' },
  confBarFill: { height: 8, borderRadius: 4 },
  confPct: { fontSize: 16, fontWeight: '800', minWidth: 40, textAlign: 'right' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#EDEFF3', paddingTop: 10 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  metaTxt: { fontSize: 12, color: COLORS.textSecondary },
  sectionDivider: { height: 1, backgroundColor: '#EDEFF3', marginVertical: 16 },
  resultBodyText: { fontSize: 13, color: COLORS.text, lineHeight: 20 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginTop: 7, marginRight: 10 },
  bulletTxt: { fontSize: 13, color: COLORS.text, flex: 1, lineHeight: 20 },
  careRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  careTxt: { fontSize: 13, color: COLORS.text, flex: 1, lineHeight: 19 },
  disclaimerResultBox: { backgroundColor: '#fff1f2', borderRadius: 16, padding: 14 },
  disclaimerResultTitle: { fontSize: 13, fontWeight: '700', color: COLORS.danger, marginBottom: 6 },
  disclaimerResultTxt: { fontSize: 12, color: '#9f1239', lineHeight: 18 },

  referralCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  referralCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  referralCardIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#ea580c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  referralCardTitle: { fontSize: 15, fontWeight: '800', color: '#9a3412' },
  referralCardSub: { fontSize: 12, color: '#c2410c', marginTop: 2 },
  referralCardReason: {
    fontSize: 13,
    color: '#7c2d12',
    lineHeight: 19,
    backgroundColor: '#ffedd5',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  referralCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ea580c',
    borderRadius: 14,
    paddingVertical: 13,
  },
  referralCardBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

  resultBtnRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  resultBtnOutline: {
    flex: 1, borderWidth: 1.5, borderColor: COLORS.primary,
    borderRadius: 16, paddingVertical: 14, alignItems: 'center',
  },
  resultBtnOutlineTxt: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
  resultBtnFilled: {
    flex: 1, backgroundColor: COLORS.primary,
    borderRadius: 16, paddingVertical: 14, alignItems: 'center',
    shadowColor: COLORS.primary, shadowOpacity: 0.22, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  resultBtnFilledTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // ─── Web-Matching Result Styles ──────────────────────────────────────────
  webResultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#64748b',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    marginBottom: 24,
  },
  webHeaderBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  webAiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#fbcfe8',
  },
  webAiPillTxt: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.primary,
  },
  webImpactPill: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  webImpactPillTxt: {
    fontSize: 11.5,
    color: '#475569',
  },
  webConditionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  webConditionSubtitle: {
    fontSize: 13,
    fontStyle: 'italic',
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  webConfidenceSection: {
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 16,
  },
  webConfHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  webConfTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
    marginRight: 8,
  },
  webConfValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  webConfSub: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 10,
  },
  webConfBarTrack: {
    height: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  webConfBarFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  webAlignCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  webAlignCardGreen: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  webAlignCardAmber: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  webAlignHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 6,
  },
  webAlignTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  webAlignBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  webEvidenceCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  webEvidenceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  webEvidenceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  webSupportPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  webSupportPillTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  webEvidenceSubtitle: {
    fontSize: 11.5,
    color: '#64748B',
    marginBottom: 12,
  },
  webFindingsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  webFindingsHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  webFindingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  webFindingTxt: {
    fontSize: 12,
    color: '#475569',
    flex: 1,
    lineHeight: 17,
  },
  webPhotosSection: {
    marginBottom: 20,
  },
  webPhotosSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10,
  },
  webPhotosRow: {
    flexDirection: 'row',
    gap: 12,
  },
  webPhotoCol: {
    flex: 1,
  },
  webPhotoImg: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
  },
    webSupportPillAmber: {
    backgroundColor: '#fef3c7',
  },
  webSupportPillTxtAmber: {
    color: '#b45309',
  },
  photoStatusBadgePrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#ecfdf5',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  photoStatusTextPrimary: {
    fontSize: 9,
    fontWeight: '700',
    color: '#065f46',
  },
  photoStatusBadgeCombined: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#eff6ff',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  photoStatusTextCombined: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1e40af',
  },
  photoStatusBadgeExcluded: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  photoStatusTextExcluded: {
    fontSize: 9,
    fontWeight: '700',
    color: '#92400e',
  },
  webPhotoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
  },
  webGuideSection: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 16,
  },
  webSectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 14,
    marginBottom: 6,
  },
  webSectionBody: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 10,
  },
  webBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  webBulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.primary,
    marginTop: 7,
    marginRight: 8,
  },
  webBulletTxt: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
    lineHeight: 19,
  },
  webCalloutBox: {
    backgroundColor: '#FDF2F8',
    borderRadius: 14,
    padding: 14,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#FCE7F3',
  },
  webCalloutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  webCalloutTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  webCalloutBody: {
    fontSize: 12.5,
    color: '#831843',
    lineHeight: 18,
  },
  webCareTipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  webCareTipTxt: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
    lineHeight: 19,
  },
  webDocBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    padding: 14,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  webDocHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  webDocTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  webDocBody: {
    fontSize: 12.5,
    color: '#78350F',
    lineHeight: 18,
  },
  webCitationsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  webCitationsTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  webCitationsGrid: {
    gap: 6,
  },
  webCitationItem: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  webCitationTxt: {
    fontSize: 11.5,
    color: '#334155',
    fontWeight: '500',
  },
  webDisclaimerBox: {
    backgroundColor: '#FFF1F2',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  webDisclaimerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  webDisclaimerTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#BE123C',
  },
  webDisclaimerBody: {
    fontSize: 11.5,
    color: '#9F1239',
    lineHeight: 17,
  },
  webActionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  webBtnOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webBtnOutlineTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  webBtnFilled: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  webBtnFilledTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

});


// ─────────────────────────────────────────────────────────────
// Dynamic AI Scanning & Dual-Photo Merge Animation Component
// ─────────────────────────────────────────────────────────────
function AIScanningAnimationView({
  imageUri,
  referenceImageUri,
}: {
  imageUri: string | null;
  referenceImageUri: string | null;
}) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  // Animated values
  const photo1Opacity = useRef(new Animated.Value(0)).current;
  const photo1Scale = useRef(new Animated.Value(0.75)).current;
  const photo1TranslateX = useRef(new Animated.Value(0)).current;

  const photo2Opacity = useRef(new Animated.Value(0)).current;
  const photo2Scale = useRef(new Animated.Value(0.75)).current;
  const photo2TranslateX = useRef(new Animated.Value(0)).current;

  const laserY = useRef(new Animated.Value(-65)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const auraOpacity = useRef(new Animated.Value(0.3)).current;
  const progressBar = useRef(new Animated.Value(0.05)).current;
  const mergeFlash = useRef(new Animated.Value(0)).current;

  const PHASES = [
    { title: 'Detecting Close-Up Lesion...', sub: 'Extracting dermatological macro texture & lesion borders' },
    { title: 'Calibrating Wide-View Context...', sub: 'Evaluating anatomical skin region & surrounding tissue' },
    { title: 'Neural Feature Extraction...', sub: 'ResNet50 cross-referencing multi-layer skin patterns' },
    { title: 'Synthesizing Dual-View Evidence...', sub: 'Merging 70/30 visual weights with questionnaire answers' },
  ];

  useEffect(() => {
    // 1. Photo 1 appears immediately (0 - 700ms)
    Animated.parallel([
      Animated.timing(photo1Opacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(photo1Scale, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Photo 2 appears at 800ms
    const timerPhoto2 = setTimeout(() => {
      setPhaseIndex(1);
      Animated.parallel([
        Animated.timing(photo2Opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(photo2Scale, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }, 800);

    // 3. Laser scan & pulsing starts at 1600ms
    const timerScan = setTimeout(() => {
      setPhaseIndex(2);

      // Looping laser scan
      Animated.loop(
        Animated.sequence([
          Animated.timing(laserY, {
            toValue: 65,
            duration: 1000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(laserY, {
            toValue: -65,
            duration: 1000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Looping pulse
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.05,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Looping aura
      Animated.loop(
        Animated.sequence([
          Animated.timing(auraOpacity, {
            toValue: 0.8,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(auraOpacity, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }, 1600);

    // 4. Merge animation at 2600ms (photos slide toward each other and merge)
    const timerMerge = setTimeout(() => {
      setPhaseIndex(3);
      Animated.parallel([
        Animated.timing(photo1TranslateX, {
          toValue: 32,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(photo2TranslateX, {
          toValue: -32,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(mergeFlash, {
            toValue: 0.85,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(mergeFlash, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }, 2600);

    // 5. Progress bar animation smoothly moving 0 -> 100% over 3400ms
    Animated.timing(progressBar, {
      toValue: 1,
      duration: 3400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    return () => {
      clearTimeout(timerPhoto2);
      clearTimeout(timerScan);
      clearTimeout(timerMerge);
    };
  }, []);

  const progressInterpolate = progressBar.interpolate({
    inputRange: [0, 1],
    outputRange: ['5%', '100%'],
  });

  const currentPhase = PHASES[phaseIndex] || PHASES[0];

  return (
    <View style={animStyles.container}>
      {/* Background Pulse Glow */}
      <Animated.View style={[animStyles.auraGlow, { opacity: auraOpacity }]} />

      {/* Header Pill */}
      <View style={animStyles.aiBadge}>
        <Ionicons name="sparkles" size={13} color={COLORS.primary} />
        <Text style={animStyles.aiBadgeText}>DERMAI NEURAL ENGINE</Text>
      </View>

      <Text style={animStyles.title}>{currentPhase.title}</Text>
      <Text style={animStyles.subtitle}>{currentPhase.sub}</Text>

      {/* Dual Photo Stage Container */}
      <View style={animStyles.stage}>
        {/* Photo 1: Close-up */}
        <Animated.View
          style={[
            animStyles.photoCard,
            {
              opacity: photo1Opacity,
              transform: [
                { scale: Animated.multiply(photo1Scale, pulseScale) },
                { translateX: photo1TranslateX },
              ],
            },
          ]}
        >
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={animStyles.photoImage} resizeMode="cover" />
          ) : (
            <View style={animStyles.placeholderPhoto}>
              <Ionicons name="image" size={32} color={COLORS.primary} />
            </View>
          )}
          <View style={animStyles.photoLabelPill}>
            <Text style={animStyles.photoLabelText}>1. Close-Up</Text>
          </View>
          {/* HUD Corner Brackets */}
          <View style={[animStyles.bracket, animStyles.bracketTL]} />
          <View style={[animStyles.bracket, animStyles.bracketTR]} />
          <View style={[animStyles.bracket, animStyles.bracketBL]} />
          <View style={[animStyles.bracket, animStyles.bracketBR]} />
        </Animated.View>

        {/* Center Connection Bridge / Icon */}
        <View style={animStyles.bridgeContainer}>
          <View style={animStyles.bridgeLine} />
          <Animated.View style={[animStyles.bridgeIconWrap, { transform: [{ scale: pulseScale }] }]}>
            <Ionicons name="git-merge" size={16} color={COLORS.primary} />
          </Animated.View>
          <View style={animStyles.bridgeLine} />
        </View>

        {/* Photo 2: Wide-view */}
        <Animated.View
          style={[
            animStyles.photoCard,
            {
              opacity: photo2Opacity,
              transform: [
                { scale: Animated.multiply(photo2Scale, pulseScale) },
                { translateX: photo2TranslateX },
              ],
            },
          ]}
        >
          {referenceImageUri ? (
            <Image source={{ uri: referenceImageUri }} style={animStyles.photoImage} resizeMode="cover" />
          ) : (
            <View style={animStyles.placeholderPhoto}>
              <Ionicons name="body" size={32} color={COLORS.primary} />
            </View>
          )}
          <View style={animStyles.photoLabelPill}>
            <Text style={animStyles.photoLabelText}>2. Wide-View</Text>
          </View>
          {/* HUD Corner Brackets */}
          <View style={[animStyles.bracket, animStyles.bracketTL]} />
          <View style={[animStyles.bracket, animStyles.bracketTR]} />
          <View style={[animStyles.bracket, animStyles.bracketBL]} />
          <View style={[animStyles.bracket, animStyles.bracketBR]} />
        </Animated.View>

        {/* Laser Scanning Beam Sweeping Vertically */}
        <Animated.View
          pointerEvents="none"
          style={[
            animStyles.laserBeam,
            { transform: [{ translateY: laserY }] },
          ]}
        >
          <View style={animStyles.laserGlow} />
        </Animated.View>

        {/* Flash Overlay when Merging */}
        <Animated.View
          pointerEvents="none"
          style={[animStyles.mergeFlashOverlay, { opacity: mergeFlash }]}
        />
      </View>

      {/* Progress Bar & Status */}
      <View style={animStyles.progressSection}>
        <View style={animStyles.progressTrack}>
          <Animated.View style={[animStyles.progressFill, { width: progressInterpolate }]} />
        </View>
        <View style={animStyles.progressFooter}>
          <Text style={animStyles.progressStatusText}>Deep neural scan running...</Text>
          <Text style={animStyles.progressWeightText}>70/30 Dual-View</Text>
        </View>
      </View>
    </View>
  );
}

const animStyles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  auraGlow: {
    position: 'absolute',
    top: -50,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#fce7f3',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fbcfe8',
    marginBottom: 12,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
    lineHeight: 17,
  },
  stage: {
    width: '100%',
    height: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    position: 'relative',
  },
  photoCard: {
    width: 125,
    height: 155,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    position: 'relative',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  placeholderPhoto: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fdf2f8',
  },
  photoLabelPill: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    paddingVertical: 3,
    alignItems: 'center',
  },
  photoLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  bridgeContainer: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  bridgeLine: {
    width: 2,
    height: 24,
    backgroundColor: '#fbcfe8',
  },
  bridgeIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fdf2f8',
    borderWidth: 1,
    borderColor: '#fbcfe8',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  bracket: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: '#ffffff',
  },
  bracketTL: { top: 6, left: 6, borderTopWidth: 2, borderLeftWidth: 2 },
  bracketTR: { top: 6, right: 6, borderTopWidth: 2, borderRightWidth: 2 },
  bracketBL: { bottom: 24, left: 6, borderBottomWidth: 2, borderLeftWidth: 2 },
  bracketBR: { bottom: 24, right: 6, borderBottomWidth: 2, borderRightWidth: 2 },
  laserBeam: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 10,
  },
  laserGlow: {
    position: 'absolute',
    top: -4,
    left: 0,
    right: 0,
    height: 11,
    backgroundColor: 'rgba(190, 24, 93, 0.25)',
    borderRadius: 6,
  },
  mergeFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    zIndex: 20,
  },
  progressSection: {
    width: '100%',
    marginTop: 18,
  },
  progressTrack: {
    height: 7,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  progressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  progressStatusText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  progressWeightText: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '700',
  },
});
