import { Suspense } from "react";
import { getProperties } from "@/lib/data";
import { Marketplace } from "@/components/marketplace/marketplace";
import { MarketplaceSkeleton } from "@/components/marketplace/marketplace-skeleton";

export default async function HomePage() {
  const properties = await getProperties();
  return (
    <Suspense fallback={<MarketplaceSkeleton />}>
      <Marketplace properties={properties} />
    </Suspense>
  );
}
