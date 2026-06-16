import Lottie from 'lottie-react';
import anim from '../assets/somelier.json';

export default function SomelierLottie({ size = 170 }: { size?: number }) {
  return <Lottie animationData={anim} loop autoplay style={{ width: size, height: size }} />;
}
