export function normalizeTiers(targetConfig) {
  normalizeCompanyTiers(targetConfig?.companies);
  normalizeTierList(targetConfig?.specialPeriod?.tiers);
}

function normalizeCompanyTiers(companies) {
  if (!companies) return;

  for (const company of Object.values(companies)) {
    normalizeTierList(company.night?.tiers);
    normalizeTierList(company.day?.tiers);
  }
}

function normalizeTierList(tiers) {
  tiers?.forEach((tier) => {
    if (tier.upToKm === null) tier.upToKm = Infinity;
  });
}
