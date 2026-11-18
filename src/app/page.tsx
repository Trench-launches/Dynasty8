import { Suspense } from "react";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Marketplace } from "@/components/marketplace/marketplace";
import { getCatalogue, getEcosystemToken } from "@/lib/catalogue";

export default function Home() {
  return (
    <Suspense fallback={<PageLoading />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const [properties, ecosystem] = await Promise.all([getCatalogue(), getEcosystemToken()]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader ecosystem={ecosystem} />
      <Marketplace initialProperties={properties} />
      <SiteFooter compact />
    </div>
  );
}
