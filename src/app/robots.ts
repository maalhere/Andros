import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Endpoints de servidor, retorno de OAuth y Vista Invitado (enlaces privados de solo lectura).
      disallow: ["/api/", "/auth/", "/ver/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
