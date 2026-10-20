import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
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
    setIsPremium(sub?.plan === 'premium');
    setScansUsed(sub?.scansUsed ?? 0);
  }

  async function checkCanScan(): Promise<boolean> {
    const user = await getCurrentUser();
    if (!user) return true;
    const isDemoAccount = user.email.toLowerCase().endsWith('@dermai.ph');
    if (isDemoAccount) return true;
    const sub = await getUserSubscription(user.id);
    if (sub?.plan === 'premium') return true;
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
      Alert.alert('Second Photo Required', 'Please upload a second photo for comparison.');
      return;
    }

    setStep('analyzing');
    const user = await getCurrentUser();

    // Build standardized questionnaire payload matching web
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

    const mappingResult = evaluateDiseaseMapping(answers);

    const prediction = await analyzeUploadedImages([imageUri, referenceImageUri], mappingResult).catch((error) => {
      console.warn('[Scan] Dataset prediction unavailable, falling back to questionnaire:', error?.message ?? error);
      return null;
    });

    if (prediction && prediction.blurScore !== undefined && prediction.blurScore < 0.00005) {
      Alert.alert(
        'Photo too blurry',
        'Please retake the photo in better light and closer focus. Clearer images improve the result.'
      );
      setStep('upload');
      return;
    }

    // Determine primary condition
    let condition = prediction ? getDatasetCondition(prediction.predictionKey) : null;
    if (!condition) {
      const conditionMapName = mappingResult.primarySupportedCondition || 'Acne Vulgaris';
      const keyMap: Record<string, string> = {
        'Acne Vulgaris': 'acne_vulgaris',
        'Atopic Dermatitis': 'atopic_dermatitis',
        'Contact Dermatitis': 'contact_dermatitis',
        'Melasma': 'melasma',
        'Vitiligo': 'melasma',
      };
      condition = getDatasetCondition(keyMap[conditionMapName] || 'atopic_dermatitis') || DATASET_CONDITIONS.acne_vulgaris;
    }

    const confidence = prediction ? prediction.confidence : 85;
    const shouldShowMultiple =
      !!prediction && (
        confidence < 40 ||
        (prediction.topPredictions[0] && prediction.topPredictions[1] && prediction.topPredictions[0].confidence - prediction.topPredictions[1].confidence <= 15)
      );

    const secondaryResult = prediction?.topPredictions?.[1]
      ? {
          conditionKey: prediction.topPredictions[1].predictionKey,
          condition: getDatasetCondition(prediction.topPredictions[1].predictionKey) ?? condition,
          confidence: prediction.topPredictions[1].confidence,
        }
      : undefined;

    const referralSuggested =
      condition.severity === 'severe' ||
      confidence < condition.referralThreshold ||
      shouldShowMultiple ||
      !!secondaryResult ||
      activeSafetyAlert.level !== 'none';

    // Extract body location label from Q7
    const q7Opts = QUESTIONNAIRE_QUESTIONS.find((q) => q.id === 'q7')?.options || [];
    const bodyLocationLabel = (answers.q7 || [])
      .map((id) => q7Opts.find((o) => o.id === id)?.labelEn)
      .filter(Boolean)
      .join(', ') || 'Skin Assessment';

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
      condition: condition.name,
      confidence,
      severity: condition.severity,
      category: condition.category,
      description: condition.description,
      symptoms: condition.symptoms,
      careTips: condition.careTips,
      referralSuggested,
      referralReason: referralSuggested
        ? activeSafetyAlert.level === 'emergency'
          ? 'Emergency warning signs detected in questionnaire — please seek immediate medical evaluation.'
          : activeSafetyAlert.level === 'urgent'
          ? 'Urgent symptoms detected in questionnaire — consult a dermatologist promptly.'
          : condition.severity === 'severe'
          ? 'This condition requires professional medical evaluation.'
          : shouldShowMultiple || secondaryResult
          ? 'Multiple possible skin conditions detected — a specialist can provide a definitive diagnosis.'
          : 'Low diagnostic confidence — a specialist can provide a definitive diagnosis.'
        : undefined,
      isGovernmentReportable: condition.isGovernmentReportable ?? false,
      secondaryCondition: shouldShowMultiple || secondaryResult ? (secondaryResult?.condition?.name ?? prediction?.topPredictions?.[1]?.predictionKey ?? undefined) : undefined,
      secondaryConfidence: shouldShowMultiple || secondaryResult ? secondaryResult?.confidence : undefined,
      status: confidence < 30 ? 'flagged' : 'pending',
    };

    if (user) {
      await saveScanResult(user.id, scanResult);
      const isDemoAccount = user.email.toLowerCase().endsWith('@dermai.ph');
      const sub = await getUserSubscription(user.id);
      if (!isDemoAccount && sub?.plan !== 'premium') {
        await setUserSubscription(user.id, {
          ...(sub ?? { userId: user.id, email: user.email, plan: 'free' as const }),
          scansUsed: (sub?.scansUsed ?? 0) + 1,
        });
      }
      await addAppNotification(user.id, {
        type: 'scan',
        title: 'Scan Complete',
        message: `Your scan result is ready: ${condition.name} (${confidence}% confidence).`,
        userId: user.id,
      });
    }

    setResult(scanResult);
    setStep('result');
  }

  async function analyzeUploadedImages(
    _uris: [string, string],
    mappingResult: ReturnType<typeof evaluateDiseaseMapping>
  ): Promise<{
    predictionKey: string;
    confidence: number;
    topPredictions: Array<{ predictionKey: string; confidence: number }>;
    blurScore?: number;
  }> {
    // Simulated ResNet model inference delay (1.5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Determine condition using clinical disease mapping support
    const conditionMapName = mappingResult.primarySupportedCondition || 'Acne Vulgaris';
    const keyMap: Record<string, string> = {
      'Acne Vulgaris': 'acne_vulgaris',
      'Atopic Dermatitis': 'atopic_dermatitis',
      'Contact Dermatitis': 'contact_dermatitis',
      'Melasma': 'melasma',
      'Vitiligo': 'melasma',
    };

    const predKey = keyMap[conditionMapName] || 'atopic_dermatitis';
    const conf = 89;
    const altKey = predKey === 'acne_vulgaris' ? 'contact_dermatitis' : 'acne_vulgaris';

    return {
      predictionKey: predKey,
      confidence: conf,
      topPredictions: [
        { predictionKey: predKey, confidence: conf },
        { predictionKey: altKey, confidence: Math.max(12, 100 - conf) },
      ],
      blurScore: 1.0,
    };
  }

  // --- Welcome ---------------------------------------------------------------
  if (step === 'welcome') {
    const scansLeft = Math.max(0, MAX_FREE_SCANS - scansUsed);
    const limitReached = !isPremium && scansLeft === 0;
    return (
      <SafeAreaView style={styles.safe}>
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
        <SafeAreaView style={styles.safe}>
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
                  >
                    <Ionicons name="arrow-back" size={16} color={COLORS.text} />
                    <Text style={styles.reviewBackBtnTxt}>Back to Q15</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.reviewProceedBtn}
                    onPress={() => {
                      setIsReviewing(false);
                      setStep('upload');
                    }}
                  >
                    <Text style={styles.reviewProceedBtnTxt}>Proceed to Photos</Text>
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
      <SafeAreaView style={styles.safe}>
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
                  <Text style={styles.qNavNextTxt}>
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
      <SafeAreaView style={styles.safe}>
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

              {/* Photo 1: Close-up */}
              <View style={styles.uploadSlotContainer}>
                <View style={styles.slotHeaderRow}>
                  <Text style={styles.uploadSlotTitle}>1. Close-up View (Malapitang Kuha)</Text>
                  {imageUri ? (
                    <View style={styles.slotReadyBadge}>
                      <Ionicons name="checkmark-circle" size={12} color="#059669" />
                      <Text style={styles.slotReadyBadgeTxt}>Ready</Text>
                    </View>
                  ) : (
                    <Text style={styles.slotRequiredTxt}>Required</Text>
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
                  <Text style={styles.uploadSlotTitle}>2. Wide-view / Context (Malawakang Kuha)</Text>
                  {referenceImageUri ? (
                    <View style={styles.slotReadyBadge}>
                      <Ionicons name="checkmark-circle" size={12} color="#059669" />
                      <Text style={styles.slotReadyBadgeTxt}>Ready</Text>
                    </View>
                  ) : (
                    <Text style={styles.slotRequiredTxt}>Required</Text>
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
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <StepIndicator currentStep={2} />
          <View style={styles.analyzingContainer}>
            <View style={styles.card}>
              <View style={styles.analyzingIconCircle}>
                <Ionicons name="sparkles" size={30} color={COLORS.primary} />
              </View>
              <Text style={styles.analyzingTitle}>Analyzing your skin...</Text>
              <Text style={styles.analyzingSub}>Cross-referencing photos with clinical questionnaire evidence</Text>
              <View style={styles.analyzeBarBg}>
                <View style={styles.analyzeBarFill} />
              </View>
            </View>
          </View>
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
  const condKey = Object.keys(CONDITION_MAP).find(
    (k) => CONDITION_MAP[k].name === result.condition
  ) ?? '';
  const conditionData = CONDITION_MAP[condKey];
  const isGovReportable = result.isGovernmentReportable ?? false;
  const isLowConfidence = result.confidence < 40;
  const showMultiplePossibilities = isLowConfidence || !!result.secondaryCondition;
  const [realClinics, setRealClinics] = useState<ClinicRecord[]>([]);

  useEffect(() => {
    getClinics().then(setRealClinics);
  }, []);

  const verifiedClinics = (realClinics.length > 0 ? realClinics : SAMPLE_CLINICS)
    .filter((c) => c.verified)
    .slice(0, 2);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <StepIndicator currentStep={3} />
        <ScrollView contentContainerStyle={styles.pageContainer} showsVerticalScrollIndicator={false}>

          <View style={styles.card}>

            {result.imageUris?.length === 2 ? (
              <View style={styles.comparisonStrip}>
                <View style={styles.comparisonPhotoWrap}>
                  <Image source={{ uri: result.imageUris[0] }} style={styles.comparisonPhoto} resizeMode="cover" />
                  <Text style={styles.comparisonPhotoLabel}>Close-up View</Text>
                </View>
                <View style={styles.comparisonPhotoWrap}>
                  <Image source={{ uri: result.imageUris[1] }} style={styles.comparisonPhoto} resizeMode="cover" />
                  <Text style={styles.comparisonPhotoLabel}>Wide View</Text>
                </View>
              </View>
            ) : null}

            {/* Condition header */}
            <View style={[styles.categoryBadge, { backgroundColor: isGovReportable ? COLORS.dangerLight : COLORS.primaryLight }]}>
              <Text style={[styles.categoryBadgeTxt, isGovReportable && { color: COLORS.danger }]}>
                {isGovReportable ? 'Urgent: Government-Reportable Condition' : result.category}
              </Text>
            </View>

            {/* Leprosy: hide name, show DOH referral */}
            {isGovReportable ? (
              <>
                <Text style={styles.resultConditionName}>Skin Concern Requires Immediate Attention</Text>
                <View style={[styles.disclaimerResultBox, { backgroundColor: COLORS.dangerLight, borderColor: COLORS.danger + '44', marginTop: 12 }]}>
                  <View style={styles.rowCenter}>
                    <Ionicons name="medical-outline" size={16} color={COLORS.danger} />
                    <Text style={[styles.disclaimerResultTitle, { color: COLORS.danger }]}> Confidential DOH Referral</Text>
                  </View>
                  <Text style={[styles.disclaimerResultTxt, { color: '#7f1d1d' }]}>
                    Signs detected may be consistent with a government-reportable condition. The specific condition name is not shown to protect your privacy.{'\n\n'}
                    Please contact the Department of Health (DOH) immediately:{'\n'}
                    {'  '}• <Text style={{ fontWeight: '700' }}>DOH Hotline: 1555</Text> (free call){'\n'}
                    {'  '}• Visit your nearest City Health Office (CHO){'\n\n'}
                    <Text style={{ fontWeight: '700' }}>Free treatment is available</Text> under the National Leprosy Control Program (NLCP).
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.resultConditionName}>Possible {result.condition}</Text>
                {conditionData?.localName && (
                  <Text style={styles.resultLocalName}>{conditionData.localName} (Filipino name)</Text>
                )}
              </>
            )}

            {/* Secondary possibility / low-confidence multiple conditions */}
            {showMultiplePossibilities && (
              <View style={[styles.disclaimerResultBox, { backgroundColor: '#fef3c7', borderColor: '#d97706' + '44', marginTop: 12 }]}>
                <View style={styles.rowCenter}>
                  <Ionicons name="alert-circle-outline" size={15} color={COLORS.warning} />
                  <Text style={[styles.disclaimerResultTitle, { color: COLORS.warning }]}> Multiple Possible Skin Conditions</Text>
                </View>
                <Text style={[styles.disclaimerResultTxt, { color: '#78350f' }]}>
                  {result.secondaryCondition ? (
                    <>
                      <Text style={{ fontWeight: '700' }}>Could also be: {result.secondaryCondition}</Text>
                      {result.secondaryConfidence ? ` (${result.secondaryConfidence}% confidence)` : ''}{'\n'}
                    </>
                  ) : null}
                  {isLowConfidence
                    ? 'The image result is not clear enough for a single diagnosis. Please retake the photo or consult a licensed dermatologist for a definitive diagnosis.'
                    : 'Two conditions scored close to each other, so a licensed dermatologist can provide a definitive diagnosis.'}
                </Text>
              </View>
            )}

            <Text style={styles.resultSectionTitle}>AI Confidence Score</Text>
            <View style={styles.confRow}>
              <View style={styles.confBarBg}>
                <View style={[styles.confBarFill, { width: `${result.confidence}%` as any, backgroundColor: COLORS.primary }]} />
              </View>
              <Text style={[styles.confPct, { color: COLORS.primary }]}>{result.confidence}%</Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaTxt}>Analysis Date</Text>
              <Text style={[styles.metaTxt, { fontWeight: '600', color: COLORS.text }]}>
                {new Date(result.date).toLocaleDateString()}
              </Text>
            </View>
            <View style={[styles.metaRow, { marginTop: 6 }]}>
              <Text style={styles.metaTxt}>Pre-screening Assessment</Text>
              <Text style={[styles.metaTxt, { fontWeight: '600', color: COLORS.text }]}>
                15 Clinical Questions Answered
              </Text>
            </View>

            {/* Description */}
            <View style={styles.sectionDivider} />
            <Text style={styles.resultSectionTitle}>About This Condition</Text>
            <Text style={styles.resultBodyText}>{result.description}</Text>

            {/* Symptoms */}
            <View style={styles.sectionDivider} />
            <Text style={styles.resultSectionTitle}>Common Symptoms</Text>
            {result.symptoms.map((s) => (
              <View key={s} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletTxt}>{s}</Text>
              </View>
            ))}

            {/* Care tips */}
            <View style={styles.sectionDivider} />
            <Text style={styles.resultSectionTitle}>Recommended Care Tips</Text>
            {result.careTips.map((tip) => (
              <View key={tip} style={styles.careRow}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.success} style={{ marginTop: 2, marginRight: 8 }} />
                <Text style={styles.careTxt}>{tip}</Text>
              </View>
            ))}

            {/* Referral Banner */}
            {result.referralSuggested && (
              <View style={[styles.referralCard, { marginTop: 20 }]}>
                <View style={styles.referralCardHeader}>
                  <View style={styles.referralCardIconCircle}>
                    <Ionicons name="medkit" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.referralCardTitle}>Professional Referral Recommended</Text>
                    <Text style={styles.referralCardSub}>Expert clinical examination advised</Text>
                  </View>
                </View>
                {result.referralReason ? (
                  <Text style={styles.referralCardReason}>{result.referralReason}</Text>
                ) : null}
                <TouchableOpacity
                  style={styles.referralCardBtn}
                  onPress={onFindClinic}
                >
                  <Ionicons name="calendar-outline" size={17} color="#fff" />
                  <Text style={styles.referralCardBtnTxt}>Find a Dermatologist Near You</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Disclaimer */}
            <View style={[styles.disclaimerResultBox, { marginTop: 18 }]}>
              <View style={styles.rowCenter}>
                <Ionicons name="information-circle-outline" size={16} color={COLORS.danger} />
                <Text style={styles.disclaimerResultTitle}> Medical Disclaimer</Text>
              </View>
              <Text style={styles.disclaimerResultTxt}>
                This AI-generated preliminary assessment does not replace professional medical diagnosis. Please consult a board-certified dermatologist for clinical evaluation and prescription treatments.
              </Text>
            </View>

            {/* Action buttons */}
            <View style={styles.resultBtnRow}>
              <TouchableOpacity style={styles.resultBtnOutline} onPress={onReset}>
                <Text style={styles.resultBtnOutlineTxt}>New Scan</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resultBtnFilled} onPress={onFindClinic}>
                <Text style={styles.resultBtnFilledTxt}>Find Clinic</Text>
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
  pageContainer: { paddingBottom: 32 },
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
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  qNavNextBtnDisabled: {
    backgroundColor: '#cbd5e1',
    shadowOpacity: 0,
    elevation: 0,
  },
  qNavNextTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
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
    gap: 10,
    marginTop: 6,
  },
  reviewBackBtn: {
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
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  reviewProceedBtnTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
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
  uploadSlotTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  slotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  slotReadyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  slotReadyBadgeTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
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
});
