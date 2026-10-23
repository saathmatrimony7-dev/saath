/**
 * Curated taxonomy seed (DESIGN.md §1.3): religions → communities →
 * sub-communities, top cities, and attribute definitions.
 * Synthetic reference data only. Admins extend this list at runtime (P2+);
 * it is intentionally a starting set, not an exhaustive census.
 * Labels: en + hi + ta (P1 i18n languages).
 */

type L = { en: string; hi: string; ta: string };
const l = (en: string, hi: string, ta: string): L => ({ en, hi, ta });

export const RELIGIONS: { id: string; label: L; sort: number }[] = [
  { id: 'hindu', label: l('Hindu', 'हिंदू', 'இந்து'), sort: 1 },
  { id: 'muslim', label: l('Muslim', 'मुस्लिम', 'முஸ்லிம்'), sort: 2 },
  { id: 'christian', label: l('Christian', 'ईसाई', 'கிறிஸ்துவர்'), sort: 3 },
  { id: 'sikh', label: l('Sikh', 'सिख', 'சீக்கியர்'), sort: 4 },
  { id: 'jain', label: l('Jain', 'जैन', 'சமணர்'), sort: 5 },
  { id: 'buddhist', label: l('Buddhist', 'बौद्ध', 'பௌத்தர்'), sort: 6 },
  { id: 'parsi', label: l('Parsi', 'पारसी', 'பார்சி'), sort: 7 },
  { id: 'no-religion', label: l('No religion / other', 'कोई धर्म नहीं / अन्य', 'சமயம் இல்லை / மற்றவை'), sort: 99 },
];

export const COMMUNITIES: { id: string; religion: string; label: L; sort: number }[] = [
  // Hindu (representative, admin-extensible)
  { id: 'hindu-brahmin', religion: 'hindu', label: l('Brahmin', 'ब्राह्मण', 'பிராமணர்'), sort: 1 },
  { id: 'hindu-iyer', religion: 'hindu', label: l('Iyer', 'अय्यर', 'ஐயர்'), sort: 2 },
  { id: 'hindu-iyengar', religion: 'hindu', label: l('Iyengar', 'अय्यंगार', 'ஐயங்கார்'), sort: 3 },
  { id: 'hindu-rajput', religion: 'hindu', label: l('Rajput', 'राजपूत', 'ராஜ்புத்ரர்'), sort: 4 },
  { id: 'hindu-maratha', religion: 'hindu', label: l('Maratha', 'मराठा', 'மராட்டியர்'), sort: 5 },
  { id: 'hindu-patel', religion: 'hindu', label: l('Patel', 'पटेल', 'படேல்'), sort: 6 },
  { id: 'hindu-reddy', religion: 'hindu', label: l('Reddy', 'रेड्डी', 'ரெட்டி'), sort: 7 },
  { id: 'hindu-nair', religion: 'hindu', label: l('Nair', 'नायर', 'நாயர்'), sort: 8 },
  { id: 'hindu-yadav', religion: 'hindu', label: l('Yadav', 'यादव', 'யாதவர்'), sort: 9 },
  { id: 'hindu-kayastha', religion: 'hindu', label: l('Kayastha', 'कायस्थ', 'காயஸ்தர்'), sort: 10 },
  { id: 'hindu-vokkaliga', religion: 'hindu', label: l('Vokkaliga', 'वोक्कलिगा', 'வொக்கலிகர்'), sort: 11 },
  { id: 'hindu-naidu', religion: 'hindu', label: l('Naidu', 'नायडू', 'நாயுடு'), sort: 12 },
  { id: 'hindu-scheduled', religion: 'hindu', label: l('SC/ST', 'अनुसूचित जाति/जनजाति', 'பட்டியல் சாதி/பழங்குடி'), sort: 13 },
  { id: 'hindu-obc', religion: 'hindu', label: l('OBC', 'अन्य पिछड़ा वर्ग', 'பிற்படுத்தப்பட்ட வகுப்பு'), sort: 14 },
  { id: 'hindu-other', religion: 'hindu', label: l('Other Hindu community', 'अन्य हिंदू समुदाय', 'பிற இந்து சமூகம்'), sort: 99 },
  // Muslim
  { id: 'muslim-sunni', religion: 'muslim', label: l('Sunni', 'सुन्नी', 'சுன்னி'), sort: 1 },
  { id: 'muslim-shia', religion: 'muslim', label: l('Shia', 'शिया', 'ஷியா'), sort: 2 },
  { id: 'muslim-other', religion: 'muslim', label: l('Other Muslim community', 'अन्य मुस्लिम समुदाय', 'பிற முஸ்லிம் சமூகம்'), sort: 99 },
  // Christian
  { id: 'christian-catholic', religion: 'christian', label: l('Catholic', 'कैथोलिक', 'கத்தோலிக்கர்'), sort: 1 },
  { id: 'christian-protestant', religion: 'christian', label: l('Protestant', 'प्रोटेस्टेंट', 'புரோட்டஸ்டன்ட்'), sort: 2 },
  { id: 'christian-orthodox', religion: 'christian', label: l('Orthodox', 'ऑर्थोडॉक्स', 'ஆர்த்தடாக்ஸ்'), sort: 3 },
  { id: 'christian-other', religion: 'christian', label: l('Other Christian community', 'अन्य ईसाई समुदाय', 'பிற கிறிஸ்துவ சமூகம்'), sort: 99 },
  // Sikh
  { id: 'sikh-jat', religion: 'sikh', label: l('Jat Sikh', 'जट सिख', 'ஜட் சீக்கியர்'), sort: 1 },
  { id: 'sikh-khatri', religion: 'sikh', label: l('Khatri', 'खत्री', 'கத்ரி'), sort: 2 },
  { id: 'sikh-other', religion: 'sikh', label: l('Other Sikh community', 'अन्य सिख समुदाय', 'பிற சீக்கிய சமூகம்'), sort: 99 },
  // Jain
  { id: 'jain-digambar', religion: 'jain', label: l('Digambar', 'दिगंबर', 'திகம்பரர்'), sort: 1 },
  { id: 'jain-shwetambar', religion: 'jain', label: l('Shwetambar', 'श्वेतांबर', 'ஸ்வேதாம்பரர்'), sort: 2 },
  // Buddhist
  { id: 'buddhist-navayana', religion: 'buddhist', label: l('Navayana', 'नवयान', 'நவயான'), sort: 1 },
  // Parsi
  { id: 'parsi-zoroastrian', religion: 'parsi', label: l('Zoroastrian', 'ज़ोरास्त्रियन', 'ஜொராஸ்ட்ரியன்'), sort: 1 },
];

export const SUB_COMMUNITIES: { id: string; community: string; label: L; sort: number }[] = [
  // A small illustrative set; admins extend per community demand.
  { id: 'hindu-brahmin-garhwali', community: 'hindu-brahmin', label: l('Garhwali', 'गढ़वाली', 'கர்வாலி'), sort: 1 },
  { id: 'hindu-brahmin-kanyakubja', community: 'hindu-brahmin', label: l('Kanyakubja', 'कान्यकुब्ज', 'கன்யாகுப்ஜர்'), sort: 2 },
  { id: 'hindu-brahmin-tamil', community: 'hindu-brahmin', label: l('Tamil Brahmin', 'तमिल ब्राह्मण', 'தமிழ் பிராமணர்'), sort: 3 },
];

export const CITIES: { id: string; state: string; label: L }[] = [
  { id: 'mumbai', state: 'maharashtra', label: l('Mumbai', 'मुंबई', 'மும்பை') },
  { id: 'delhi', state: 'delhi', label: l('Delhi NCR', 'दिल्ली एनसीआर', 'டெல்லி என்சிஆர்') },
  { id: 'bengaluru', state: 'karnataka', label: l('Bengaluru', 'बेंगलुरु', 'பெங்களூரு') },
  { id: 'hyderabad', state: 'telangana', label: l('Hyderabad', 'हैदराबाद', 'ஹைதராபாத்') },
  { id: 'chennai', state: 'tamil-nadu', label: l('Chennai', 'चेन्नई', 'சென்னை') },
  { id: 'kolkata', state: 'west-bengal', label: l('Kolkata', 'कोलकाता', 'கொல்கத்தா') },
  { id: 'pune', state: 'maharashtra', label: l('Pune', 'पुणे', 'புணே') },
  { id: 'ahmedabad', state: 'gujarat', label: l('Ahmedabad', 'अहमदाबाद', 'அகமதாபாத்') },
  { id: 'jaipur', state: 'rajasthan', label: l('Jaipur', 'जयपुर', 'ஜெய்ப்பூர்') },
  { id: 'lucknow', state: 'uttar-pradesh', label: l('Lucknow', 'लखनऊ', 'லக்னோ') },
  { id: 'kochi', state: 'kerala', label: l('Kochi', 'कोच्चि', 'கொச்சி') },
  { id: 'coimbatore', state: 'tamil-nadu', label: l('Coimbatore', 'कोयंबटूर', 'கோயம்புத்தூர்') },
  { id: 'indore', state: 'madhya-pradesh', label: l('Indore', 'इंदौर', 'இந்தூர்') },
  { id: 'nagpur', state: 'maharashtra', label: l('Nagpur', 'नागपुर', 'நாக்பூர்') },
  { id: 'bhopal', state: 'madhya-pradesh', label: l('Bhopal', 'भोपाल', 'போபால்') },
  { id: 'patna', state: 'bihar', label: l('Patna', 'पटना', 'பாட்னா') },
  { id: 'surat', state: 'gujarat', label: l('Surat', 'सूरत', 'சூரத்') },
  { id: 'chandigarh', state: 'chandigarh', label: l('Chandigarh', 'चंडीगढ़', 'சண்டிகர்') },
  { id: 'other', state: 'other', label: l('Other', 'अन्य', 'மற்றவை') },
];

export interface AttributeOption {
  value: string;
  label: L;
}
export interface AttributeDefSeed {
  key: string;
  communityScope: string | null;
  type: 'text' | 'single_select' | 'multi_select' | 'boolean';
  sensitivity: 'C2' | 'C3';
  label: L;
  options?: AttributeOption[];
}

export const ATTRIBUTE_DEFINITIONS: AttributeDefSeed[] = [
  {
    key: 'diet',
    communityScope: null,
    type: 'single_select',
    sensitivity: 'C3',
    label: l('Diet', 'आहार', 'உணவு'),
    options: [
      { value: 'veg', label: l('Vegetarian', 'शाकाहारी', 'சைவம்') },
      { value: 'eggetarian', label: l('Eggetarian', 'अंडाहारी', 'முட்டை உண்ணுபவர்') },
      { value: 'non_veg', label: l('Non-vegetarian', 'मांसाहारी', 'அசைவம்') },
      { value: 'jain_veg', label: l('Jain vegetarian', 'जैन शाकाहारी', 'சமண சைவம்') },
      { value: 'vegan', label: l('Vegan', 'शुद्ध शाकाहारी', 'வீகன்') },
    ],
  },
  {
    key: 'gotra',
    communityScope: 'hindu-brahmin',
    type: 'text',
    sensitivity: 'C3',
    label: l('Gotra', 'गोत्र', 'கோத்திரம்'),
  },
  {
    key: 'manglik_status',
    communityScope: null, // offered for all Hindu communities via UI scope rules
    type: 'single_select',
    sensitivity: 'C3',
    label: l('Manglik status', 'मांगलिक स्थिति', 'செவ்வாய் தோஷ நிலை'),
    options: [
      { value: 'manglik', label: l('Manglik', 'मांगलिक', 'செவ்வாய் தோஷம் உண்டு') },
      { value: 'partial', label: l('Partial / Anshik', 'आंशिक', 'பகுதி') },
      { value: 'non_manglik', label: l('Non-Manglik', 'गैर-मांगलिक', 'தோஷம் இல்லை') },
      { value: 'dont_know', label: l("Don't know", 'पता नहीं', 'தெரியாது') },
    ],
  },
  {
    key: 'namaz_practice',
    communityScope: 'muslim-sunni',
    type: 'single_select',
    sensitivity: 'C3',
    label: l('Namaz practice', 'नमाज़', 'தொழுகை'),
    options: [
      { value: 'five_times', label: l('Five times daily', 'दिन में पाँच बार', 'தினமும் ஐந்து முறை') },
      { value: 'regular', label: l('Regularly', 'नियमित', 'தொழுகை நடைமுறை') },
      { value: 'occasional', label: l('Occasionally', 'कभी-कभी', 'அவ்வப்போது') },
    ],
  },
];
