export function calcDriverReward(totalSales, tripCount, driverType = 1) {
  const params = driverType === 2
    ? { rate: 0.30, bonus: 50 }
    : { rate: 0.25, bonus: 30 };

  const baseAmount = Math.round(totalSales / 1.12);
  const commissionRaw = baseAmount * params.rate;
  const commission = Math.floor(commissionRaw / 100) * 100;
  const tripBonus = tripCount * params.bonus;
  const totalReward = commission + tripBonus;

  return { baseAmount, commission, tripBonus, totalReward };
}
