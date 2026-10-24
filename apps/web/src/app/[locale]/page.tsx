import { redirect } from 'next/navigation';

export default function LocaleIndex() {
  // The middleware guards /onboarding; land signed-in users on the interview.
  redirect('/login');
}
