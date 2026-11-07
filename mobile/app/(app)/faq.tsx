import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { getFaqsAsync, PATIENT_FAQS, type FAQItem } from '@/lib/faqData';

export default function FAQScreen() {
  const router = useRouter();
  const [faqs, setFaqs] = useState<FAQItem[]>(PATIENT_FAQS);
  const [loading, setLoading] = useState(true);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  useEffect(() => {
    let isMounted = true;
    getFaqsAsync()
      .then((data) => {
        if (isMounted && data && data.length > 0) {
          setFaqs(data);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const toggleAccordion = (index: number) => {
    setOpenIdx((prev) => (prev === index ? null : index));
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header with back */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Frequently Asked Questions</Text>
          <Text style={styles.headerSub}>Find quick answers to common questions</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeTxt}>{faqs.length} questions</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingTxt}>Loading FAQs...</Text>
          </View>
        ) : (
          <View style={styles.accordionContainer}>
            {faqs.map((faq, i) => {
              const isOpen = openIdx === i;
              return (
                <View key={faq.id || i} style={[styles.faqCard, isOpen && styles.faqCardOpen]}>
                  <TouchableOpacity
                    style={styles.faqHeaderBtn}
                    onPress={() => toggleAccordion(i)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.faqQuestionTxt,
                        isOpen && styles.faqQuestionTxtOpen,
                      ]}
                    >
                      {faq.q}
                    </Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={isOpen ? COLORS.primary : '#94A3B8'}
                      style={{ marginLeft: 8 }}
                    />
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={styles.faqAnswerContainer}>
                      <Text style={styles.faqAnswerTxt}>{faq.a}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Still Need Assistance Card (Web Parity) */}
        <View style={styles.supportCard}>
          <View style={styles.supportHeaderRow}>
            <View style={styles.supportIconBox}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.supportCardTitle}>Still need direct assistance?</Text>
              <Text style={styles.supportCardSub}>
                You can reach our official team directly at
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.emailPill}
            onPress={() => Linking.openURL('mailto:dermaisupport@gmail.com')}
            activeOpacity={0.7}
          >
            <Ionicons name="mail" size={15} color={COLORS.primary} />
            <Text style={styles.emailPillTxt}>dermaisupport@gmail.com</Text>
          </TouchableOpacity>

          <View style={styles.phoneRow}>
            <Ionicons name="call-outline" size={14} color="#64748B" />
            <Text style={styles.phoneTxt}>(032) 888-3472</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  countBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countBadgeTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  scrollContent: {
    padding: 16,
  },
  loadingBox: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingTxt: {
    fontSize: 13,
    color: '#64748B',
  },
  accordionContainer: {
    gap: 10,
    marginBottom: 20,
  },
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  faqCardOpen: {
    borderColor: '#F4C9DC',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  faqHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  faqQuestionTxt: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    lineHeight: 20,
  },
  faqQuestionTxtOpen: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  faqAnswerContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  faqAnswerTxt: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
  },
  supportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginTop: 8,
  },
  supportHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  supportIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  supportCardSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  emailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDF2F7',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 14,
  },
  emailPillTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingLeft: 4,
  },
  phoneTxt: {
    fontSize: 12,
    color: '#64748B',
  },
});

