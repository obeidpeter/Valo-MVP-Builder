/**
 * Hand-labelled tender corpus for the eval harness v0 (FR-EXT-05, BP §9).
 *
 * Each entry is a realistic public-procurement tender (SADC/West-African
 * flavour, matching the domain the workbench serves) paired with a VERIFIED
 * ground-truth list of the discrete submission requirements a competent
 * reviewer would expect the engine to surface. The harness runs the real
 * extraction engine over `documentText` and measures recall against
 * `groundTruth` (see scripts/run-eval-harness.ts and lib/evalHarness.ts).
 *
 * Labelling rules (kept consistent so recall stays reproducible):
 *  - One ground-truth row per discrete, checkable obligation actually stated
 *    in the text — never an obligation the text does not state.
 *  - `match` is an AND-of-ORs keyword spec: enough alternatives to tolerate
 *    the engine's paraphrasing, tight enough that an unrelated requirement
 *    cannot satisfy it by accident.
 *  - `mandatory` mirrors what the clause says (MUST/shall/mandatory vs
 *    should/desirable), independent of whether the engine agrees.
 *
 * This is v0 (>= 10 tenders). The v1.0 bar (>= 25 tenders, >= 95% recall) is
 * out of scope here.
 */
import type { EvalTender } from "../../src/lib/evalHarness";

export const CORPUS: EvalTender[] = [
  {
    id: "VMT-2026-014-chemicals",
    title: "Supply and delivery of water treatment chemicals",
    documentText: `VALO MUNICIPALITY — TENDER VMT-2026-014: SUPPLY AND DELIVERY OF WATER TREATMENT CHEMICALS

Page 2
Clause 3.1  Bidders MUST submit a valid original Tax Clearance Certificate (or SARS Tax Compliance Status PIN) confirming the bidder's tax affairs are in order. Failure to submit will result in disqualification.

Page 3
Clause 4.2  Bidders MUST provide a valid B-BBEE Status Level Verification Certificate issued by a SANAS-accredited verification agency. This is a mandatory eligibility requirement.

Page 4
Clause 5.1  A bid security (bid bond) of ZAR 50,000.00 valid for 90 days MUST accompany the bid. Bids submitted without the required bid security shall be rejected as non-responsive.

Page 5
Clause 6.3  Bidders should provide at least three (3) contactable reference letters from previous clients of similar scope. This is desirable but not mandatory.

Page 6
Clause 7.1  Bidders MUST submit a valid Company Registration certificate (CIPC registration document).`,
    groundTruth: [
      {
        id: "tax-clearance",
        label: "Valid Tax Clearance Certificate / SARS Tax Compliance PIN",
        mandatory: true,
        match: [["tax clearance", "tax compliance", "sars"], ["certificate", "pin", "status"]],
      },
      {
        id: "bbee",
        label: "B-BBEE Status Level Verification Certificate",
        mandatory: true,
        match: [["b-bbee", "bbee", "b bbee"], ["certificate", "verification", "status level"]],
      },
      {
        id: "bid-security",
        label: "Bid security / bid bond of ZAR 50,000 valid 90 days",
        mandatory: true,
        match: [["bid security", "bid bond"]],
      },
      {
        id: "references",
        label: "Three contactable reference letters (desirable)",
        mandatory: false,
        match: [["reference"], ["three", "contactable", "letters"]],
      },
      {
        id: "company-registration",
        label: "Company Registration (CIPC) certificate",
        mandatory: true,
        match: [["company registration", "cipc", "registration"], ["certificate", "document", "registration"]],
      },
    ],
  },
  {
    id: "NNPC-2026-207-piping",
    title: "Procurement of industrial piping and fittings",
    documentText: `NATIONAL NORTHERN PROCUREMENT COMMISSION — INVITATION TO TENDER NNPC-2026-207

Section 3: Eligibility
3.1  Bidders MUST possess a valid CAC (Corporate Affairs Commission) certificate of incorporation.
3.2  Bidders MUST submit evidence of a valid PENCOM compliance certificate.
3.3  Bidders MUST provide a current Tax Clearance Certificate for the last three (3) years.
3.4  Bidders MUST submit an ITF (Industrial Training Fund) compliance certificate.

Section 4: Financial
4.1  Bidders shall submit audited financial statements for the preceding three (3) financial years.
4.2  A bid security equal to 2% of the total bid price is mandatory and must be issued by a reputable bank.

Section 5: Technical
5.1  Bidders should submit an organisational chart and CVs of key personnel.`,
    groundTruth: [
      {
        id: "cac",
        label: "Valid CAC certificate of incorporation",
        mandatory: true,
        match: [["cac", "corporate affairs"], ["certificate", "incorporation"]],
      },
      {
        id: "pencom",
        label: "Valid PENCOM compliance certificate",
        mandatory: true,
        match: [["pencom"], ["compliance", "certificate"]],
      },
      {
        id: "tax-clearance-3y",
        label: "Tax Clearance Certificate for last three years",
        mandatory: true,
        match: [["tax clearance"], ["certificate", "three", "3 years", "years"]],
      },
      {
        id: "itf",
        label: "ITF compliance certificate",
        mandatory: true,
        match: [["itf", "industrial training fund"], ["compliance", "certificate"]],
      },
      {
        id: "audited-financials",
        label: "Audited financial statements (3 years)",
        mandatory: true,
        match: [["audited"], ["financial statements", "financial", "accounts", "statements"]],
      },
      {
        id: "bid-security-2pct",
        label: "Bid security equal to 2% of bid price",
        mandatory: true,
        match: [["bid security", "bid bond"], ["2%", "2 %", "2 percent", "2 per cent"]],
      },
      {
        id: "org-chart",
        label: "Organisational chart and CVs of key personnel (desirable)",
        mandatory: false,
        match: [["organisational chart", "organizational chart", "cvs", "key personnel"]],
      },
    ],
  },
  {
    id: "KZN-HEALTH-2026-031-ppe",
    title: "Supply of personal protective equipment",
    documentText: `KWAZULU DEPARTMENT OF HEALTH — TENDER KZN-HEALTH-2026-031: SUPPLY OF PPE

1. Bidders MUST be registered on the Central Supplier Database (CSD) and provide the CSD registration/summary report.
2. Bidders MUST submit a valid Tax Compliance Status PIN.
3. All PPE offered MUST carry valid SABS/ISO certification; certificates of conformance MUST be attached.
4. Bidders MUST complete and sign the SBD 4 (Declaration of Interest) form.
5. Delivery MUST be completed within 21 calendar days of order. Bidders shall confirm the delivery lead time in writing.
6. Bidders should provide product samples on request.`,
    groundTruth: [
      {
        id: "csd",
        label: "Central Supplier Database (CSD) registration report",
        mandatory: true,
        match: [["csd", "central supplier database"], ["registration", "summary", "report"]],
      },
      {
        id: "tax-pin",
        label: "Valid Tax Compliance Status PIN",
        mandatory: true,
        match: [["tax compliance", "tax clearance"], ["pin", "status"]],
      },
      {
        id: "sabs-iso",
        label: "SABS/ISO certification / certificate of conformance for PPE",
        mandatory: true,
        match: [["sabs", "iso", "conformance"], ["certification", "certificate", "conformance"]],
      },
      {
        id: "sbd4",
        label: "Signed SBD 4 Declaration of Interest",
        mandatory: true,
        match: [["sbd 4", "sbd4", "declaration of interest"]],
      },
      {
        id: "delivery-leadtime",
        label: "Delivery within 21 days / confirm lead time",
        mandatory: true,
        match: [["delivery", "lead time"], ["21", "days", "written", "writing"]],
      },
      {
        id: "samples",
        label: "Product samples on request (desirable)",
        mandatory: false,
        match: [["sample", "samples"]],
      },
    ],
  },
  {
    id: "EGH-2026-118-roadworks",
    title: "Rehabilitation of the R512 district road",
    documentText: `EASTERN GROWTH HIGHWAYS — TENDER EGH-2026-118: REHABILITATION OF DISTRICT ROAD R512

C1.1  Bidders MUST hold a valid CIDB grading of 7CE or higher. Proof of CIDB registration MUST be attached.
C1.2  Bidders MUST submit a valid Letter of Good Standing from the Compensation Fund (COIDA).
C1.3  A bid guarantee of 5% of the tender sum, valid for 120 days, is mandatory.
C1.4  Bidders MUST submit a fully priced Bill of Quantities. Any BOQ line left unpriced renders the bid non-responsive.
C1.5  Bidders MUST provide a Health and Safety plan compliant with the Construction Regulations.
C1.6  Bidders shall submit a construction programme (Gantt chart) indicating a completion period not exceeding 9 months.`,
    groundTruth: [
      {
        id: "cidb",
        label: "Valid CIDB grading 7CE or higher",
        mandatory: true,
        match: [["cidb"], ["grading", "7ce", "registration", "grade"]],
      },
      {
        id: "coida",
        label: "Letter of Good Standing (COIDA / Compensation Fund)",
        mandatory: true,
        match: [["good standing", "coida", "compensation fund"]],
      },
      {
        id: "bid-guarantee-5pct",
        label: "Bid guarantee of 5% valid 120 days",
        mandatory: true,
        match: [["bid guarantee", "bid security", "guarantee"], ["5%", "5 %", "5 percent", "120"]],
      },
      {
        id: "priced-boq",
        label: "Fully priced Bill of Quantities",
        mandatory: true,
        match: [["bill of quantities", "boq"], ["priced", "pricing", "unpriced", "responsive"]],
      },
      {
        id: "hs-plan",
        label: "Health and Safety plan (Construction Regulations)",
        mandatory: true,
        match: [["health and safety", "safety plan"], ["plan", "construction regulations"]],
      },
      {
        id: "programme",
        label: "Construction programme / Gantt within 9 months",
        mandatory: true,
        match: [["programme", "program", "gantt"], ["9 months", "completion", "months"]],
      },
    ],
  },
  {
    id: "UNIV-2026-045-ict",
    title: "Supply, delivery and installation of network equipment",
    documentText: `SOUTHERN CAPE UNIVERSITY — RFB UNIV-2026-045: NETWORK EQUIPMENT

2.1  Bidders MUST be an OEM-authorised reseller and MUST attach a manufacturer's authorisation letter (MAF) dated within the last 3 months.
2.2  All equipment MUST be brand-new, original and covered by a minimum 3-year manufacturer warranty.
2.3  Bidders MUST provide a valid Tax Clearance Certificate.
2.4  Bidders MUST submit at least two (2) reference sites of similar installations completed in the last 5 years.
2.5  Bidders MUST provide certified copies of the directors' identity documents.
2.6  Bidders should offer optional on-site training for ICT staff.`,
    groundTruth: [
      {
        id: "maf",
        label: "Manufacturer's authorisation letter (MAF) within 3 months",
        mandatory: true,
        match: [["manufacturer", "oem", "maf", "authorisation", "authorization"], ["authorisation", "authorization", "letter", "reseller"]],
      },
      {
        id: "warranty",
        label: "Minimum 3-year manufacturer warranty, brand-new equipment",
        mandatory: true,
        match: [["warranty", "brand-new", "brand new", "original"], ["3-year", "3 year", "warranty", "years"]],
      },
      {
        id: "tax-clearance",
        label: "Valid Tax Clearance Certificate",
        mandatory: true,
        match: [["tax clearance", "tax compliance"], ["certificate", "status", "pin"]],
      },
      {
        id: "reference-sites",
        label: "Two reference sites (last 5 years)",
        mandatory: true,
        match: [["reference"], ["two", "sites", "site"]],
      },
      {
        id: "director-ids",
        label: "Certified copies of directors' ID documents",
        mandatory: true,
        match: [["director", "directors"], ["identity", "id document", "id documents", "certified"]],
      },
      {
        id: "training",
        label: "Optional on-site training (desirable)",
        mandatory: false,
        match: [["training"]],
      },
    ],
  },
  {
    id: "CITY-2026-089-fleet",
    title: "Three-year fleet maintenance service contract",
    documentText: `METRO CITY COUNCIL — TENDER CITY-2026-089: FLEET MAINTENANCE (3 YEARS)

A. Bidders MUST submit a valid Tax Compliance Status PIN and CSD summary report.
B. Bidders MUST hold valid public liability insurance of not less than ZAR 5 million; a certificate of insurance MUST be attached.
C. Bidders MUST operate a workshop within a 30 km radius of the city depot and provide proof of premises (lease or title deed).
D. Bidders MUST submit a completed and signed SBD 1 (Invitation to Bid) and SBD 6.1 (Preference Points Claim) forms.
E. Bidders MUST provide a service-level commitment with a maximum turnaround time of 48 hours per vehicle.
F. Bidders should provide evidence of ISO 9001 quality management certification.`,
    groundTruth: [
      {
        id: "tax-csd",
        label: "Tax Compliance PIN and CSD summary report",
        mandatory: true,
        match: [["tax compliance", "tax clearance"], ["pin", "csd", "status"]],
      },
      {
        id: "public-liability",
        label: "Public liability insurance >= ZAR 5 million",
        mandatory: true,
        match: [["public liability", "liability insurance", "insurance"], ["5 million", "insurance", "certificate"]],
      },
      {
        id: "workshop-radius",
        label: "Workshop within 30 km / proof of premises",
        mandatory: true,
        match: [["workshop", "premises"], ["30 km", "radius", "lease", "title deed", "premises"]],
      },
      {
        id: "sbd-forms",
        label: "Signed SBD 1 and SBD 6.1 forms",
        mandatory: true,
        match: [["sbd 1", "sbd1", "sbd 6", "sbd6"]],
      },
      {
        id: "sla-turnaround",
        label: "Service-level commitment, 48-hour turnaround",
        mandatory: true,
        match: [["service level", "service-level", "turnaround"], ["48", "hours", "turnaround"]],
      },
      {
        id: "iso9001",
        label: "ISO 9001 certification (desirable)",
        mandatory: false,
        match: [["iso 9001", "iso9001"]],
      },
    ],
  },
  {
    id: "PWR-2026-160-solar",
    title: "Design and installation of a rooftop solar PV plant",
    documentText: `PROVINCIAL POWER UTILITY — TENDER PWR-2026-160: 500 kWp ROOFTOP SOLAR PV

R1  Bidders MUST be a registered PV GreenCard installer and attach the installer certificate.
R2  Bidders MUST submit a valid Electrical Contractor registration with the Department of Labour (wireman's licence).
R3  Bidders MUST provide a bid security of ZAR 200,000 valid for 90 days.
R4  Proposed PV modules and inverters MUST be on the current approved-products list and carry IEC certification.
R5  Bidders MUST submit a detailed priced Bill of Quantities and a single-line electrical diagram.
R6  Bidders MUST provide a minimum 5-year workmanship warranty and a 10-year performance guarantee on modules.
R7  Bidders should provide a maintenance plan for the first two years.`,
    groundTruth: [
      {
        id: "greencard",
        label: "PV GreenCard installer certificate",
        mandatory: true,
        match: [["greencard", "green card", "pv green"], ["installer", "certificate"]],
      },
      {
        id: "electrical-registration",
        label: "Electrical Contractor registration / wireman's licence",
        mandatory: true,
        match: [["electrical contractor", "wireman", "department of labour"], ["registration", "licence", "license"]],
      },
      {
        id: "bid-security",
        label: "Bid security ZAR 200,000 valid 90 days",
        mandatory: true,
        match: [["bid security", "bid bond"], ["200", "90 days", "valid"]],
      },
      {
        id: "iec-approved",
        label: "IEC-certified modules/inverters on approved list",
        mandatory: true,
        match: [["iec", "approved-products", "approved products"], ["certification", "certified", "approved", "list"]],
      },
      {
        id: "priced-boq-diagram",
        label: "Priced BOQ and single-line diagram",
        mandatory: true,
        match: [["bill of quantities", "boq", "single-line", "single line"], ["priced", "diagram", "pricing"]],
      },
      {
        id: "warranty",
        label: "5-year workmanship warranty, 10-year performance guarantee",
        mandatory: true,
        match: [["warranty", "guarantee"], ["5-year", "5 year", "10-year", "10 year", "workmanship", "performance"]],
      },
      {
        id: "maintenance-plan",
        label: "Two-year maintenance plan (desirable)",
        mandatory: false,
        match: [["maintenance"], ["plan", "two years", "2 years"]],
      },
    ],
  },
  {
    id: "EDU-2026-072-catering",
    title: "School nutrition programme catering services",
    documentText: `DEPARTMENT OF EDUCATION — TENDER EDU-2026-072: SCHOOL NUTRITION CATERING

i.    Bidders MUST hold a valid Certificate of Acceptability for food premises issued under the Health Act.
ii.   Bidders MUST submit a valid Tax Clearance Certificate and CSD registration.
iii.  Bidders MUST provide proof of a valid food-handling / HACCP certification for all staff.
iv.   Bidders MUST demonstrate capacity to deliver 5,000 meals per day and submit a distribution plan.
v.    Bidders MUST submit a B-BBEE certificate; preference points apply per the PPPFA.
vi.   Bidders shall provide two trade references from previous catering contracts.`,
    groundTruth: [
      {
        id: "acceptability",
        label: "Certificate of Acceptability for food premises",
        mandatory: true,
        match: [["acceptability", "food premises", "health act"], ["certificate", "acceptability"]],
      },
      {
        id: "tax-csd",
        label: "Tax Clearance Certificate and CSD registration",
        mandatory: true,
        match: [["tax clearance", "tax compliance"], ["certificate", "csd", "status"]],
      },
      {
        id: "haccp",
        label: "Food-handling / HACCP certification",
        mandatory: true,
        match: [["haccp", "food-handling", "food handling"], ["certification", "certificate"]],
      },
      {
        id: "capacity",
        label: "Capacity for 5,000 meals/day + distribution plan",
        mandatory: true,
        match: [["meals", "distribution", "capacity"], ["5000", "5,000", "distribution", "plan", "per day"]],
      },
      {
        id: "bbee",
        label: "B-BBEE certificate (PPPFA preference)",
        mandatory: true,
        match: [["b-bbee", "bbee", "b bbee"], ["certificate", "preference", "pppfa"]],
      },
      {
        id: "trade-refs",
        label: "Two trade references (desirable)",
        mandatory: false,
        match: [["reference", "references"], ["two", "trade"]],
      },
    ],
  },
  {
    id: "PORT-2026-019-security",
    title: "Provision of physical security services",
    documentText: `NATIONAL PORTS AUTHORITY — TENDER PORT-2026-019: SECURITY SERVICES

1) Bidders MUST be registered with PSIRA (Private Security Industry Regulatory Authority) and attach a valid PSIRA certificate.
2) All deployed officers MUST be PSIRA-graded Grade C or above; a schedule of graded officers MUST be submitted.
3) Bidders MUST submit a valid Letter of Good Standing (COIDA).
4) Bidders MUST provide proof of compliance with the minimum wage as per the Sectoral Determination for private security.
5) Bidders MUST hold public liability insurance of at least ZAR 10 million.
6) Bidders MUST submit a valid Tax Compliance Status PIN.
7) Bidders should provide a control-room and incident-reporting capability description.`,
    groundTruth: [
      {
        id: "psira-reg",
        label: "PSIRA company registration certificate",
        mandatory: true,
        match: [["psira"], ["certificate", "registered", "registration"]],
      },
      {
        id: "graded-officers",
        label: "PSIRA Grade C+ officers schedule",
        mandatory: true,
        match: [["grade c", "graded", "psira-graded"], ["officers", "grade", "schedule"]],
      },
      {
        id: "coida",
        label: "Letter of Good Standing (COIDA)",
        mandatory: true,
        match: [["good standing", "coida"]],
      },
      {
        id: "minimum-wage",
        label: "Proof of Sectoral Determination minimum-wage compliance",
        mandatory: true,
        match: [["minimum wage", "sectoral determination"], ["compliance", "minimum wage", "determination"]],
      },
      {
        id: "public-liability",
        label: "Public liability insurance >= ZAR 10 million",
        mandatory: true,
        match: [["public liability", "liability insurance"], ["10 million", "insurance"]],
      },
      {
        id: "tax-pin",
        label: "Valid Tax Compliance Status PIN",
        mandatory: true,
        match: [["tax compliance", "tax clearance"], ["pin", "status"]],
      },
      {
        id: "control-room",
        label: "Control-room / incident-reporting capability (desirable)",
        mandatory: false,
        match: [["control-room", "control room", "incident"], ["control room", "incident", "reporting"]],
      },
    ],
  },
  {
    id: "AGRI-2026-133-irrigation",
    title: "Supply and installation of a centre-pivot irrigation system",
    documentText: `REGIONAL AGRICULTURE BOARD — TENDER AGRI-2026-133: CENTRE-PIVOT IRRIGATION

Q1  Bidders MUST submit company registration documents and a valid Tax Clearance Certificate.
Q2  Bidders MUST provide a valid water-use authorisation / licence in terms of the National Water Act.
Q3  A bid security of ZAR 75,000 valid for 90 days is mandatory.
Q4  Bidders MUST submit a detailed technical proposal including pump sizing calculations and a hydraulic design.
Q5  Bidders MUST offer a minimum 24-month warranty on the pivot structure and drive units.
Q6  Bidders MUST provide evidence of at least three (3) similar centre-pivot installations.
Q7  Bidders should indicate local content percentage in accordance with SABS local-content requirements.`,
    groundTruth: [
      {
        id: "reg-tax",
        label: "Company registration + Tax Clearance Certificate",
        mandatory: true,
        match: [["company registration", "registration", "tax clearance"], ["tax clearance", "certificate", "registration"]],
      },
      {
        id: "water-licence",
        label: "Water-use authorisation / licence (National Water Act)",
        mandatory: true,
        match: [["water-use", "water use", "national water act"], ["authorisation", "authorization", "licence", "license"]],
      },
      {
        id: "bid-security",
        label: "Bid security ZAR 75,000 valid 90 days",
        mandatory: true,
        match: [["bid security", "bid bond"], ["75", "90 days", "valid"]],
      },
      {
        id: "technical-proposal",
        label: "Technical proposal with pump sizing and hydraulic design",
        mandatory: true,
        match: [["technical proposal", "pump sizing", "hydraulic"], ["proposal", "calculations", "design", "sizing"]],
      },
      {
        id: "warranty",
        label: "Minimum 24-month warranty",
        mandatory: true,
        match: [["warranty"], ["24", "month", "months"]],
      },
      {
        id: "similar-installs",
        label: "Three similar centre-pivot installations",
        mandatory: true,
        match: [["installations", "installation", "similar"], ["three", "centre-pivot", "centre pivot"]],
      },
      {
        id: "local-content",
        label: "Local-content percentage (desirable)",
        mandatory: false,
        match: [["local content", "local-content"]],
      },
    ],
  },
  {
    id: "HOSP-2026-058-laundry",
    title: "Hospital linen and laundry services",
    documentText: `PROVINCIAL HEALTH SERVICES — TENDER HOSP-2026-058: LINEN AND LAUNDRY

L1  Bidders MUST submit a valid Tax Compliance Status PIN and CSD summary.
L2  Bidders MUST provide a valid Certificate of Acceptability for the laundry premises.
L3  Bidders MUST demonstrate an infection-control protocol compliant with SANS 10146 for healthcare textiles.
L4  Bidders MUST hold public liability insurance of not less than ZAR 5 million.
L5  Bidders MUST submit a signed SBD 4 (Declaration of Interest).
L6  Bidders MUST provide a collection and delivery schedule with a 24-hour turnaround.
L7  Bidders should submit a B-BBEE verification certificate.`,
    groundTruth: [
      {
        id: "tax-csd",
        label: "Tax Compliance PIN and CSD summary",
        mandatory: true,
        match: [["tax compliance", "tax clearance"], ["pin", "csd", "status"]],
      },
      {
        id: "acceptability",
        label: "Certificate of Acceptability for laundry premises",
        mandatory: true,
        match: [["acceptability", "premises"], ["certificate", "acceptability", "premises"]],
      },
      {
        id: "infection-control",
        label: "Infection-control protocol (SANS 10146)",
        mandatory: true,
        match: [["infection", "sans 10146", "sans"], ["control", "protocol", "10146"]],
      },
      {
        id: "public-liability",
        label: "Public liability insurance >= ZAR 5 million",
        mandatory: true,
        match: [["public liability", "liability insurance"], ["5 million", "insurance"]],
      },
      {
        id: "sbd4",
        label: "Signed SBD 4 Declaration of Interest",
        mandatory: true,
        match: [["sbd 4", "sbd4", "declaration of interest"]],
      },
      {
        id: "schedule",
        label: "Collection/delivery schedule, 24-hour turnaround",
        mandatory: true,
        match: [["collection", "delivery", "schedule", "turnaround"], ["24", "hour", "schedule", "turnaround"]],
      },
      {
        id: "bbee",
        label: "B-BBEE verification certificate (desirable)",
        mandatory: false,
        match: [["b-bbee", "bbee", "b bbee"], ["certificate", "verification"]],
      },
    ],
  },
  {
    id: "NG-FMOH-2026-014-lab-equipment",
    title: "Federal goods tender — laboratory equipment (Nigeria)",
    documentText: `INVITATION TO TENDER — FEDERAL MINISTRY OF HEALTH
Tender No. FMOH/2026/EQ/014 — Supply and Installation of Laboratory Equipment.
Instructions to Bidders (ITB):
12.1 Bidders must submit a valid CAC certificate of incorporation.
12.2 Bidders must submit evidence of current tax clearance for the last three (3) years.
12.3 Bidders must submit a current PENCOM compliance certificate.
12.4 Bidders must submit a current ITF compliance certificate.
12.5 Bidders must submit a current NSITF compliance certificate.
14.0 Bids must be accompanied by evidence of registration on the BPP National Database of Contractors (Interim Registration Report).
19.1 Bids must be accompanied by a bid security of two percent (2%) of the bid price from a reputable bank.
21.0 The bid shall remain valid for a period of ninety (90) days from the date of bid opening.
23.2 Bidders should, where possible, provide brochures of the offered equipment.
25.0 Bids must be submitted in one (1) original and two (2) copies, each clearly marked.`,
    groundTruth: [
      {
        id: "cac-cert",
        label: "Valid CAC certificate of incorporation",
        mandatory: true,
        match: [["cac", "certificate of incorporation", "corporate affairs commission"]],
      },
      {
        id: "tax-clearance",
        label: "Tax clearance for the last three years",
        mandatory: true,
        match: [["tax clearance", "tax compliance"], ["three", "3"]],
      },
      {
        id: "pencom",
        label: "Current PENCOM compliance certificate",
        mandatory: true,
        match: [["pencom", "pension"], ["compliance", "certificate"]],
      },
      {
        id: "itf",
        label: "Current ITF compliance certificate",
        mandatory: true,
        match: [["itf", "industrial training fund"], ["compliance", "certificate"]],
      },
      {
        id: "nsitf",
        label: "Current NSITF compliance certificate",
        mandatory: true,
        match: [["nsitf", "social insurance"], ["compliance", "certificate"]],
      },
      {
        id: "bpp-database",
        label: "Registration on the BPP National Database of Contractors",
        mandatory: true,
        match: [["bpp", "national database"], ["registration", "contractors"]],
      },
      {
        id: "bid-security",
        label: "Bid security of 2% of the bid price from a reputable bank",
        mandatory: true,
        match: [["bid security", "bid bond"], ["2", "two percent"]],
      },
      {
        id: "bid-validity",
        label: "Bid valid for ninety days from bid opening",
        mandatory: true,
        match: [["valid", "validity"], ["90", "ninety"]],
      },
      {
        id: "copies",
        label: "One original and two copies, clearly marked",
        mandatory: true,
        match: [["original"], ["two", "2"], ["copies", "copy"]],
      },
      {
        id: "brochures",
        label: "Brochures of the offered equipment (desirable)",
        mandatory: false,
        match: [["brochure"]],
      },
    ],
  },
  {
    id: "NG-NIPEX-2026-ML-0042-marine",
    title: "NIPEX oil & gas — marine logistics services (Nigeria)",
    documentText: `NIPEX TENDER — PROVISION OF MARINE LOGISTICS SERVICES (ITT No. 2026/ML/0042).
Pre-qualification requirements:
1. Evidence of registration and valid categorisation on the NIPEX Joint Qualification System (NJQS) in product code 3.99.12.
2. Valid NCDMB Nigerian Content Equipment Certificate (NCEC) or evidence of application.
3. A Nigerian Content Plan demonstrating minimum 70% Nigerian content, submitted with the technical bid.
4. Valid Certificate of Registration with the Department of Petroleum Resources / NUPRC as applicable.
5. Evidence of ownership or bareboat charter of at least two (2) DP2 platform supply vessels not older than 15 years.
6. Valid ISM Code Document of Compliance and Safety Management Certificate for each vessel.
7. HSE statistics for the last three (3) years including LTIF and TRIR.
8. Bidders are encouraged to attend the virtual clarification session.
Commercial bids will be opened only for bidders that pass the technical evaluation.`,
    groundTruth: [
      {
        id: "njqs",
        label: "NJQS registration and categorisation in product code 3.99.12",
        mandatory: true,
        match: [["njqs", "joint qualification"]],
      },
      {
        id: "ncec",
        label: "NCDMB Nigerian Content Equipment Certificate or application evidence",
        mandatory: true,
        match: [["ncdmb", "ncec", "nigerian content equipment"]],
      },
      {
        id: "nc-plan",
        label: "Nigerian Content Plan demonstrating minimum 70% Nigerian content",
        mandatory: true,
        match: [["nigerian content plan"], ["70"]],
      },
      {
        id: "dpr-nuprc",
        label: "Certificate of registration with DPR / NUPRC",
        mandatory: true,
        match: [["dpr", "nuprc", "department of petroleum"], ["registration", "certificate"]],
      },
      {
        id: "vessels",
        label: "Ownership or bareboat charter of two DP2 platform supply vessels",
        mandatory: true,
        match: [["dp2", "platform supply vessel"], ["two", "2"]],
      },
      {
        id: "ism",
        label: "ISM Code Document of Compliance and Safety Management Certificate per vessel",
        mandatory: true,
        match: [["ism"], ["document of compliance", "safety management"]],
      },
      {
        id: "hse-stats",
        label: "HSE statistics for three years including LTIF and TRIR",
        mandatory: true,
        match: [["hse"], ["ltif", "trir", "statistics"]],
      },
      {
        id: "clarification",
        label: "Attend the virtual clarification session (desirable)",
        mandatory: false,
        match: [["clarification session"]],
      },
    ],
  },
  {
    id: "NG-FMW-2026-road-rehab",
    title: "Federal works tender — road rehabilitation (Nigeria)",
    documentText: `FEDERAL MINISTRY OF WORKS — TENDER FOR REHABILITATION OF 24KM ACCESS ROAD.
Eligibility Criteria:
(a) Certificate of incorporation with CAC including certified true copies of Forms CAC2 and CAC7.
(b) Company audited accounts for the last three (3) years.
(c) Evidence of financial capability: a bank reference letter and evidence of access to a credit line of not less than N200,000,000.
(d) Verifiable evidence of at least three (3) similar road projects executed in the last five (5) years, including letters of award and completion certificates.
(e) List of construction equipment with proof of ownership or lease agreement.
(f) Key personnel: a COREN-registered civil engineer as project manager with minimum 10 years experience (CV and certificates required).
(g) A sworn affidavit disclosing whether any officer of the ministry is a former or present director of the company.
Submission: Technical and financial bids in two separate sealed envelopes, both enclosed in one outer envelope.
Note: Site visit is recommended before bid submission.`,
    groundTruth: [
      {
        id: "cac-forms",
        label: "CAC incorporation certificate with Forms CAC2 and CAC7",
        mandatory: true,
        match: [["cac"], ["cac2", "cac 2", "cac7", "cac 7"]],
      },
      {
        id: "audited-accounts",
        label: "Audited accounts for the last three years",
        mandatory: true,
        match: [["audited accounts", "audited financial"], ["three", "3"]],
      },
      {
        id: "credit-line",
        label: "Bank reference letter and credit line of not less than N200,000,000",
        mandatory: true,
        match: [["bank reference", "credit line", "financial capability"], ["200 000 000", "two hundred million"]],
      },
      {
        id: "similar-projects",
        label: "Three similar road projects in the last five years with award letters and completion certificates",
        mandatory: true,
        match: [["similar", "road projects"], ["three", "3"], ["five", "5"]],
      },
      {
        id: "equipment-list",
        label: "Construction equipment list with proof of ownership or lease",
        mandatory: true,
        match: [["equipment"], ["ownership", "lease"]],
      },
      {
        id: "coren-engineer",
        label: "COREN-registered civil engineer as project manager",
        mandatory: true,
        match: [["coren"], ["engineer", "project manager"]],
      },
      {
        id: "affidavit",
        label: "Sworn affidavit disclosing ministry officers as directors",
        mandatory: true,
        match: [["affidavit"], ["director", "officer"]],
      },
      {
        id: "two-envelopes",
        label: "Technical and financial bids in two separate sealed envelopes",
        mandatory: true,
        match: [["envelope"], ["technical", "financial"]],
      },
      {
        id: "site-visit",
        label: "Site visit before bid submission (desirable)",
        mandatory: false,
        match: [["site visit"]],
      },
    ],
  },
];
