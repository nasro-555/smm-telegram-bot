// Bootstrap display priorities, not measured worldwide sales statistics.
const DEFAULT_COUNTRY_ORDER = [
  "US", "GB", "CA", "RU", "NL", "DE", "FR", "ID", "IN", "BR",
  "TR", "MY", "PH", "TH", "VN", "AU", "ES", "IT", "AE", "PK"
];

export function sortCountriesByCustomers(packages, customerCounts = []) {
  const counts = new Map(customerCounts.map((row) => [
    String(row.country_id), Number(row.customers) || 0
  ]));
  const priorities = new Map(DEFAULT_COUNTRY_ORDER.map((iso, i) => [iso, i]));
  return [...packages].sort((a, b) => {
    const customers = (counts.get(String(b.countryId)) || 0) -
      (counts.get(String(a.countryId)) || 0);
    if (customers) return customers;
    const priority = (priorities.get(String(a.countryIso2).toUpperCase()) ?? Infinity) -
      (priorities.get(String(b.countryIso2).toUpperCase()) ?? Infinity);
    if (priority) return priority;
    return a.countryName.localeCompare(b.countryName, "en", { sensitivity: "base" }) ||
      Number(a.countryId) - Number(b.countryId);
  });
}
