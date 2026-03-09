const rawUserData = {
  email: "test@example.com",
  rank_paygrade: "E5",
  years_of_service: 8,
  base: "Lackland AFB",
  spouse_present: true,
  children_count: 2,
  household_size: 4,

  base_pay_monthly: 3200,
  bah_monthly: 2400,
  bas_monthly: 460,
  spouse_income_monthly: 1800,

  monthly_expenses: 2200,
  entertainment: 1000,
  shopping: 250,

  monthly_debt: 3200,
  credit_cards: 900,
  auto_loan: 700,
  student_loans: 1100,
  personal_loans: 500,

  projected_home_price: 350000,
  downpayment: 17500,
  bedrooms: 5,
  bathrooms: 3,
  garage_spaces: 3,
  property_type: "single_family",

  credit_score: 716,
  market_avg_home_price: 315000,
  market_avg_rent: 2400
};

const schema = BrainSchemaX.build(rawUserData);

console.log(schema);
console.log(BrainSchemaX.toSummary(schema));

BrainSchemaX.saveToStorage(schema, "pcsunited.brain_schema_x.v1");
