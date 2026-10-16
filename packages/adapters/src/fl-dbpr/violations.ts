// Food service violation categories 01–58 in the inspection files ("Extracts After 1/1/2013"),
// from the division's public records layout, captured 2026-10-16:
// https://www2.myfloridalicense.com/hotels-restaurants/public-records/
// riskFactor: marked † (a foodborne-illness risk factor); primary: marked * (must be corrected
// at once). Categories no longer used are left out.
export const foodViolations: Record<
  string,
  { name: string; riskFactor: boolean; primary: boolean }
> = {
  '01': { name: 'Approved source', riskFactor: true, primary: false },
  '02': {
    name: 'Original container: properly labeled, date marking, consumer advisory',
    riskFactor: true,
    primary: false,
  },
  '03': {
    name: 'Time and Temperature Control – potentially hazardous/time/temperature control for safety foods (PH/TCS)',
    riskFactor: true,
    primary: false,
  },
  '04': {
    name: 'Facilities to maintain PH/TCS at the proper temperature',
    riskFactor: false,
    primary: true,
  },
  '05': {
    name: 'Food and food equipment thermometers provided and accurate',
    riskFactor: false,
    primary: true,
  },
  '06': { name: 'PH/TCS foods properly thawed', riskFactor: false, primary: false },
  '07': { name: 'Unwrapped or PH/TCS food not re-served', riskFactor: true, primary: false },
  '08': { name: 'Food protection, cross-contamination', riskFactor: true, primary: false },
  '09': {
    name: 'Bare hand contact with RTE food; Alternative Operating Procedure (AOP)',
    riskFactor: true,
    primary: false,
  },
  '10': {
    name: 'In use food dispensing utensils properly stored',
    riskFactor: false,
    primary: false,
  },
  '11': {
    name: 'Employee health knowledge; ill/symptomatic employee present',
    riskFactor: true,
    primary: false,
  },
  '12': {
    name: 'Hands washed and clean, good hygienic practices, eating / drinking /smoking',
    riskFactor: true,
    primary: false,
  },
  '13': {
    name: 'Clean clothes; hair restraints; jewelry; painted/artificial fingernails',
    riskFactor: false,
    primary: false,
  },
  '14': {
    name: 'Food-contact and nonfood-contact surfaces designed, constructed, maintained, installed, located',
    riskFactor: false,
    primary: false,
  },
  '16': {
    name: 'Dishwashing facilities; chemical test kit(s); gauges',
    riskFactor: false,
    primary: true,
  },
  '21': {
    name: 'Wiping cloths; clean and soiled linens; laundry facilities',
    riskFactor: false,
    primary: false,
  },
  '22': { name: 'Food-contact surfaces clean and sanitized', riskFactor: true, primary: false },
  '23': { name: 'Non-food contact surfaces clean', riskFactor: false, primary: false },
  '24': {
    name: 'Storage/handling of clean equipment, utensils; air drying',
    riskFactor: false,
    primary: false,
  },
  '25': { name: 'Single-service and single-use items', riskFactor: false, primary: false },
  '27': {
    name: 'Water source safe, hot (100°F) and cold under pressure',
    riskFactor: false,
    primary: true,
  },
  '28': { name: 'Sewage and wastewater disposed properly', riskFactor: false, primary: true },
  '29': {
    name: 'Plumbing installed and maintained; mop sink; water filters; backflow prevention',
    riskFactor: false,
    primary: true,
  },
  '31': {
    name: 'Hand wash sinks, hand washing supplies and hand wash sign',
    riskFactor: true,
    primary: false,
  },
  '32': { name: 'Bathrooms', riskFactor: false, primary: false },
  '33': { name: 'Garbage and refuse; premises maintained', riskFactor: false, primary: false },
  '35': {
    name: 'No presence or breeding of insects/rodents/pests; no live animals, outer openings protected from insects/pests, rodent proof.',
    riskFactor: false,
    primary: true,
  },
  '36': {
    name: 'Floors, walls, ceilings and attached equipment properly constructed and clean; rooms and equipment properly vented',
    riskFactor: false,
    primary: false,
  },
  '38': {
    name: 'Lighting provided as required; fixtures shielded or bulbs protected',
    riskFactor: false,
    primary: false,
  },
  '40': { name: 'Employee personal belongings', riskFactor: false, primary: false },
  '41': { name: 'Chemicals/toxic substances', riskFactor: true, primary: false },
  '42': { name: 'Cleaning and maintenance equip', riskFactor: false, primary: false },
  '43': {
    name: 'Complete separation from living/sleeping area/private premise; kitchen restricted – no unauthorized personnel',
    riskFactor: false,
    primary: false,
  },
  '45': {
    name: 'Fire extinguishing equipment (FOR REPORTING PURPOSES ONLY)',
    riskFactor: false,
    primary: false,
  },
  '46': {
    name: 'Exits not blocked or locked (FOR REPORTING PURPOSES ONLY)',
    riskFactor: false,
    primary: false,
  },
  '47': {
    name: 'Electrical wiring/outlets in good repair (FOR REPORTING PURPOSES ONLY)',
    riskFactor: false,
    primary: false,
  },
  '48': {
    name: 'Gas appliances; boiler certificate current/posted (FOR REPORTING PURPOSES ONLY)',
    riskFactor: false,
    primary: false,
  },
  '49': {
    name: 'Flammable/combustible materials (FOR REPORTING PURPOSES ONLY)',
    riskFactor: false,
    primary: false,
  },
  '50': { name: 'Current license properly displayed', riskFactor: false, primary: true },
  '51': { name: 'Other conditions sanitary and safe operation', riskFactor: false, primary: false },
  '52': { name: 'Misrepresentation; misbranding', riskFactor: false, primary: true },
  '53': {
    name: 'Food management certification valid / Employee training verification',
    riskFactor: true,
    primary: false,
  },
  '54': { name: 'Florida Clean Indoor Air Act', riskFactor: false, primary: false },
  '55': { name: 'Automatic Gratuity Notice', riskFactor: false, primary: false },
};
