import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, CameraType, FlashMode, useCameraPermissions } from 'expo-camera';
import { COLORS } from '@/lib/constants';

interface LiveCameraModalProps {
  visible: boolean;
  onClose: () => void;
  onCapture: (uri: string) => void;
  title?: string;
  subtitle?: string;
}

export default function LiveCameraModal({
  visible,
  onClose,
  onCapture,
  title = 'Live Skin Camera',
  subtitle = 'Center the affected skin lesion within the frame',
}: LiveCameraModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (visible && (!permission || !permission.granted)) {
      requestPermission();
    }
  }, [visible, permission]);

  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing) return;
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: Platform.OS === 'android',
      });
      if (photo?.uri) {
        setPreviewUri(photo.uri);
      }
    } catch (err) {
      console.warn('[LiveCameraModal] Capture error:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRetake = () => {
    setPreviewUri(null);
  };

  const handleConfirm = () => {
    if (previewUri) {
      onCapture(previewUri);
      setPreviewUri(null);
      onClose();
    }
  };

  const handleClose = () => {
    setPreviewUri(null);
    onClose();
  };

  const toggleFacing = () => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  const toggleFlash = () => {
    setFlash((prev) => (prev === 'off' ? 'on' : 'off'));
  };

  if (!visible) return null;

  // Permission not granted view
  if (!permission || !permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.permissionSafe}>
          <View style={styles.permissionContainer}>
            <View style={styles.permIconCircle}>
              <Ionicons name="camera-outline" size={48} color={COLORS.primary} />
            </View>
            <Text style={styles.permTitle}>Camera Access Required</Text>
            <Text style={styles.permSub}>
              DermAI needs access to your camera to capture live real-time photos of your skin condition.
            </Text>
            <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnTxt}>Enable Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.permCloseBtn} onPress={handleClose}>
              <Text style={styles.permCloseBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {previewUri ? (
          // ── Photo Review Screen ──
          <View style={styles.previewWrapper}>
            <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <SafeAreaView style={styles.previewOverlay}>
              <View style={styles.previewTopBar}>
                <Text style={styles.previewHeaderTxt}>Review Photo</Text>
              </View>

              <View style={styles.previewBottomBar}>
                <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.retakeBtnTxt}>Retake</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.usePhotoBtn} onPress={handleConfirm}>
                  <Ionicons name="checkmark" size={20} color="#fff" />
                  <Text style={styles.usePhotoBtnTxt}>Use Photo</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </View>
        ) : (
          // ── Live Camera Stream ──
          <View style={StyleSheet.absoluteFill}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              flash={flash}
              mode="picture"
            />

            <SafeAreaView style={styles.cameraOverlay}>
              {/* Top Controls */}
              <View style={styles.topBar}>
                <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>

                <View style={styles.titleBadge}>
                  <Text style={styles.titleBadgeTxt} numberOfLines={1}>{title}</Text>
                </View>

                <View style={styles.topRightBtns}>
                  <TouchableOpacity style={styles.iconBtn} onPress={toggleFlash}>
                    <Ionicons
                      name={flash === 'on' ? 'flash' : 'flash-off-outline'}
                      size={20}
                      color={flash === 'on' ? '#facc15' : '#fff'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={toggleFacing}>
                    <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Center Reticle / Target Guides */}
              <View style={styles.reticleContainer}>
                <View style={styles.reticleBox}>
                  {/* Corner marks */}
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <View style={styles.guideBadge}>
                  <Ionicons name="scan-outline" size={14} color="#fff" />
                  <Text style={styles.guideBadgeTxt}>{subtitle}</Text>
                </View>
              </View>

              {/* Bottom Controls */}
              <View style={styles.bottomBar}>
                <View style={{ width: 44 }} />
                <TouchableOpacity
                  style={styles.shutterOuter}
                  onPress={handleCapture}
                  disabled={isCapturing}
                  activeOpacity={0.8}
                >
                  <View style={styles.shutterInner}>
                    {isCapturing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <View style={styles.shutterCore} />
                    )}
                  </View>
                </TouchableOpacity>
                <View style={{ width: 44 }} />
              </View>
            </SafeAreaView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionSafe: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionContainer: {
    padding: 30,
    alignItems: 'center',
    maxWidth: 360,
  },
  permIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  permSub: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  permBtnTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  permCloseBtn: {
    paddingVertical: 10,
  },
  permCloseBtnTxt: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
  },

  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: '55%',
  },
  titleBadgeTxt: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  topRightBtns: {
    flexDirection: 'row',
    gap: 8,
  },

  reticleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleBox: {
    width: 260,
    height: 260,
    position: 'relative',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: COLORS.primary,
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 18,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 18,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 18,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 18,
  },
  guideBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  guideBadgeTxt: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },

  previewWrapper: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  previewTopBar: {
    alignItems: 'center',
    paddingTop: 12,
  },
  previewHeaderTxt: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  previewBottomBar: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  retakeBtnTxt: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  usePhotoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  usePhotoBtnTxt: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
