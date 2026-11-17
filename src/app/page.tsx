import { SiteHeader } from "@/components/layout/site-header";
import { Marketplace } from "@/components/marketplace/marketplace";
import { getCatalogue, getEcosystemToken } from "@/lib/catalogue";

export default async function Home() {
  const [properties, ecosystem] = await Promise.all([getCatalogue(), getEcosystemToken()]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader ecosystem={ecosystem} />
      <Marketplace initialProperties={properties} />
    </div>
  );
}
