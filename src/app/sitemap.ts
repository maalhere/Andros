import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const LEGAL_REVISION = new Date("2026-11-19");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/privacidad`, lastModified: LEGAL_REVISION, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terminos`, lastModified: LEGAL_REVISION, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/cookies`, lastModified: LEGAL_REVISION, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/reembolsos`, lastModified: LEGAL_REVISION, changeFrequency: "yearly", priority: 0.2 },
  ];
}
