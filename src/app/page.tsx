import { FieldCanvas } from "@/components/field/FieldCanvas";
import { AccountBar } from "@/components/AccountBar";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";

export default function Home() {
  return (
    <>
      <FieldCanvas />
      <AccountBar />
      <OnboardingTour />
    </>
  );
}
