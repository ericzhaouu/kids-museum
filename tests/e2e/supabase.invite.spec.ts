import { expect, test } from "@playwright/test";
import {
  createAdminClient,
  createCurator,
  createPublishedExhibition,
  createVisitInvitation,
  insertArtwork,
} from "../support/supabase-local";

test("@supabase invite visit grants access to local private exhibition", async ({
  page,
}) => {
  const admin = createAdminClient();
  const curator = await createCurator("playwright");
  const artworkOne = await insertArtwork(admin, curator.museumId, {
    title: "Playwright artwork 1",
    status: "published",
  });
  const artworkTwo = await insertArtwork(admin, curator.museumId, {
    title: "Playwright artwork 2",
    status: "published",
  });
  await createPublishedExhibition(admin, curator.museumId, [artworkOne, artworkTwo]);
  const invite = await createVisitInvitation(admin, curator.museumId);

  await page.goto(`/visit/${invite.token}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("家庭私享")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始参观" })).toBeVisible();
});
