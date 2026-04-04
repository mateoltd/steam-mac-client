import type { SteamApp } from '../../shared/types';

interface StoreSearchResponse {
  total: number;
  items: {
    type: string;
    name: string;
    id: number;
    tiny_image: string;
    platforms: {
      windows: boolean;
      mac: boolean;
      linux: boolean;
    };
  }[];
}

export async function searchGames(query: string): Promise<SteamApp[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({
    term: query,
    l: 'english',
    cc: 'US',
  });

  const url = `https://store.steampowered.com/api/storesearch/?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Steam API returned ${response.status}`);
  }

  const data = (await response.json()) as StoreSearchResponse;

  return data.items.map((item) => ({
    id: item.id,
    name: item.name,
    tinyImage: item.tiny_image || null,
    platforms: {
      windows: item.platforms.windows,
      mac: item.platforms.mac,
      linux: item.platforms.linux,
    },
  }));
}
