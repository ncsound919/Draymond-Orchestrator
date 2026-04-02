import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://theupliftlab.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/network`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  const modules = [
    "learn",
    "health",
    "wealth",
    "ventures",
    "justice",
    "community",
  ];

  const moduleRoutes: MetadataRoute.Sitemap = modules.map((mod) => ({
    url: `${BASE_URL}/modules/${mod}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.85,
  }));

  return [...staticRoutes, ...moduleRoutes];
}
