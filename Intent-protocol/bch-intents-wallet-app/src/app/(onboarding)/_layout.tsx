import { Stack } from 'expo-router';
import { useTheme } from '@/ui/theme';

export default function OnboardingLayout() {
  const { c } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg0 }, animation: 'slide_from_right' }} />;
}
