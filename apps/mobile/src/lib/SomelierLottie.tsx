import LottieView from 'lottie-react-native';
import anim from '../assets/somelier.json';

export default function SomelierLottie({ size = 170 }: { size?: number }) {
  return <LottieView source={anim} autoPlay loop style={{ width: size, height: size }} />;
}
