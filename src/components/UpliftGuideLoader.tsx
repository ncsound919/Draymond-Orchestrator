"use client";

import dynamic from "next/dynamic";

const UpliftGuide = dynamic(() => import("@/components/UpliftGuide"), {
  ssr: false,
});

export default function UpliftGuideLoader() {
  return <UpliftGuide />;
}
