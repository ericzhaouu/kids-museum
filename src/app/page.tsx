import { MuseumExperience } from "@/components/museum-experience";
import { featuredExhibition } from "@/lib/museum-data";
import { getPublishedExhibition } from "@/lib/exhibitions.server";
import { redirect } from "next/navigation";
import { resolveAccessibleMuseumId } from "@/lib/museum-access";
import { hasSupabaseConfig } from "@/lib/supabase/config";

export default async function Home() {
  if (!hasSupabaseConfig()) {
    return <MuseumExperience exhibition={featuredExhibition} />;
  }

  const museumId = await resolveAccessibleMuseumId();
  if (!museumId) {
    redirect("/login?reason=private");
  }

  const exhibition = await getPublishedExhibition(museumId);
  return <MuseumExperience exhibition={exhibition} />;
}
