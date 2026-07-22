import { redirect } from 'next/navigation'

// The path picker is gone - we ship a single onboarding flow (BYO keys + SDK install
// + optional repo mapping). Anyone hitting /onboarding goes straight to step 1.
export default function OnboardingRedirectPage() {
  redirect('/onboarding/direct')
}
