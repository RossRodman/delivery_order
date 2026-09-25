/** Fixed seed rows (plan.md §4.3, names from design.md). Fixed UUIDs so tests/scripts can reference them. */
export const SEED_USERS = {
  amina: { id: "11111111-1111-4111-8111-000000000001", name: "Amina", role: "adviser" as const },
  yusuf: { id: "11111111-1111-4111-8111-000000000002", name: "Yusuf", role: "owner" as const },
};

export const SEED_DEALERS = {
  alNoor: { id: "22222222-2222-4222-8222-000000000001", name: "Al-Noor Trading", city: "Khartoum" },
  kordofan: { id: "22222222-2222-4222-8222-000000000002", name: "Kordofan Supplies", city: "El-Obeid" },
  blueNile: { id: "22222222-2222-4222-8222-000000000003", name: "Blue Nile Traders", city: "Wad Madani" },
  redSea: { id: "22222222-2222-4222-8222-000000000004", name: "Red Sea Agro", city: "Port Sudan" },
};

export const SEED_PRODUCTS = {
  pump: { id: "33333333-3333-4333-8333-000000000001", sku: "PUMP-01", name: "Water pump", unitPriceCents: 51_500 },
  filter: { id: "33333333-3333-4333-8333-000000000002", sku: "FILT-02", name: "Filter", unitPriceCents: 81_000 },
  battery: { id: "33333333-3333-4333-8333-000000000003", sku: "BATT-03", name: "Battery", unitPriceCents: 207_000 },
  hose: { id: "33333333-3333-4333-8333-000000000004", sku: "HOSE-04", name: "Hose kit", unitPriceCents: 4_500 },
  controller: { id: "33333333-3333-4333-8333-000000000005", sku: "CTRL-05", name: "Controller", unitPriceCents: 12_000 },
};

export const SEED_GLOBAL_RATE = 8_200;
