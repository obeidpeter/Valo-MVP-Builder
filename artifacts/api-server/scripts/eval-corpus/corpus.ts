/**
 * Synthetic-style inline tender corpus for the Gate-0 self-check.
 *
 * Each entry is a public-procurement scenario paired with a repository label
 * list. No retained source document, authorisation record, annotator identity,
 * independent adjudication or holdout evidence accompanies these fixtures.
 * They are not production evaluation evidence. The harness can run the real
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
 * Production promotion requires the separate manifest contract, at least 25
 * authorised holdout cases, required cohorts and the production metric gates.
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
        match: [
          ["tax clearance", "tax compliance", "sars"],
          ["certificate", "pin", "status"],
        ],
      },
      {
        id: "bbee",
        label: "B-BBEE Status Level Verification Certificate",
        mandatory: true,
        match: [
          ["b-bbee", "bbee", "b bbee"],
          ["certificate", "verification", "status level"],
        ],
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
        match: [
          ["company registration", "cipc", "registration"],
          ["certificate", "document", "registration"],
        ],
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
        match: [
          ["cac", "corporate affairs"],
          ["certificate", "incorporation"],
        ],
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
        match: [
          ["tax clearance"],
          ["certificate", "three", "3 years", "years"],
        ],
      },
      {
        id: "itf",
        label: "ITF compliance certificate",
        mandatory: true,
        match: [
          ["itf", "industrial training fund"],
          ["compliance", "certificate"],
        ],
      },
      {
        id: "audited-financials",
        label: "Audited financial statements (3 years)",
        mandatory: true,
        match: [
          ["audited"],
          ["financial statements", "financial", "accounts", "statements"],
        ],
      },
      {
        id: "bid-security-2pct",
        label: "Bid security equal to 2% of bid price",
        mandatory: true,
        match: [
          ["bid security", "bid bond"],
          ["2%", "2 %", "2 percent", "2 per cent"],
        ],
      },
      {
        id: "org-chart",
        label: "Organisational chart and CVs of key personnel (desirable)",
        mandatory: false,
        match: [
          [
            "organisational chart",
            "organizational chart",
            "cvs",
            "key personnel",
          ],
        ],
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
        match: [
          ["csd", "central supplier database"],
          ["registration", "summary", "report"],
        ],
      },
      {
        id: "tax-pin",
        label: "Valid Tax Compliance Status PIN",
        mandatory: true,
        match: [
          ["tax compliance", "tax clearance"],
          ["pin", "status"],
        ],
      },
      {
        id: "sabs-iso",
        label: "SABS/ISO certification / certificate of conformance for PPE",
        mandatory: true,
        match: [
          ["sabs", "iso", "conformance"],
          ["certification", "certificate", "conformance"],
        ],
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
        match: [
          ["delivery", "lead time"],
          ["21", "days", "written", "writing"],
        ],
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
        match: [
          ["bid guarantee", "bid security", "guarantee"],
          ["5%", "5 %", "5 percent", "120"],
        ],
      },
      {
        id: "priced-boq",
        label: "Fully priced Bill of Quantities",
        mandatory: true,
        match: [
          ["bill of quantities", "boq"],
          ["priced", "pricing", "unpriced", "responsive"],
        ],
      },
      {
        id: "hs-plan",
        label: "Health and Safety plan (Construction Regulations)",
        mandatory: true,
        match: [
          ["health and safety", "safety plan"],
          ["plan", "construction regulations"],
        ],
      },
      {
        id: "programme",
        label: "Construction programme / Gantt within 9 months",
        mandatory: true,
        match: [
          ["programme", "program", "gantt"],
          ["9 months", "completion", "months"],
        ],
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
        match: [
          ["manufacturer", "oem", "maf", "authorisation", "authorization"],
          ["authorisation", "authorization", "letter", "reseller"],
        ],
      },
      {
        id: "warranty",
        label: "Minimum 3-year manufacturer warranty, brand-new equipment",
        mandatory: true,
        match: [
          ["warranty", "brand-new", "brand new", "original"],
          ["3-year", "3 year", "warranty", "years"],
        ],
      },
      {
        id: "tax-clearance",
        label: "Valid Tax Clearance Certificate",
        mandatory: true,
        match: [
          ["tax clearance", "tax compliance"],
          ["certificate", "status", "pin"],
        ],
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
        match: [
          ["director", "directors"],
          ["identity", "id document", "id documents", "certified"],
        ],
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
        match: [
          ["tax compliance", "tax clearance"],
          ["pin", "csd", "status"],
        ],
      },
      {
        id: "public-liability",
        label: "Public liability insurance >= ZAR 5 million",
        mandatory: true,
        match: [
          ["public liability", "liability insurance", "insurance"],
          ["5 million", "insurance", "certificate"],
        ],
      },
      {
        id: "workshop-radius",
        label: "Workshop within 30 km / proof of premises",
        mandatory: true,
        match: [
          ["workshop", "premises"],
          ["30 km", "radius", "lease", "title deed", "premises"],
        ],
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
        match: [
          ["service level", "service-level", "turnaround"],
          ["48", "hours", "turnaround"],
        ],
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
        match: [
          ["greencard", "green card", "pv green"],
          ["installer", "certificate"],
        ],
      },
      {
        id: "electrical-registration",
        label: "Electrical Contractor registration / wireman's licence",
        mandatory: true,
        match: [
          ["electrical contractor", "wireman", "department of labour"],
          ["registration", "licence", "license"],
        ],
      },
      {
        id: "bid-security",
        label: "Bid security ZAR 200,000 valid 90 days",
        mandatory: true,
        match: [
          ["bid security", "bid bond"],
          ["200", "90 days", "valid"],
        ],
      },
      {
        id: "iec-approved",
        label: "IEC-certified modules/inverters on approved list",
        mandatory: true,
        match: [
          ["iec", "approved-products", "approved products"],
          ["certification", "certified", "approved", "list"],
        ],
      },
      {
        id: "priced-boq-diagram",
        label: "Priced BOQ and single-line diagram",
        mandatory: true,
        match: [
          ["bill of quantities", "boq", "single-line", "single line"],
          ["priced", "diagram", "pricing"],
        ],
      },
      {
        id: "warranty",
        label: "5-year workmanship warranty, 10-year performance guarantee",
        mandatory: true,
        match: [
          ["warranty", "guarantee"],
          [
            "5-year",
            "5 year",
            "10-year",
            "10 year",
            "workmanship",
            "performance",
          ],
        ],
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
        match: [
          ["acceptability", "food premises", "health act"],
          ["certificate", "acceptability"],
        ],
      },
      {
        id: "tax-csd",
        label: "Tax Clearance Certificate and CSD registration",
        mandatory: true,
        match: [
          ["tax clearance", "tax compliance"],
          ["certificate", "csd", "status"],
        ],
      },
      {
        id: "haccp",
        label: "Food-handling / HACCP certification",
        mandatory: true,
        match: [
          ["haccp", "food-handling", "food handling"],
          ["certification", "certificate"],
        ],
      },
      {
        id: "capacity",
        label: "Capacity for 5,000 meals/day + distribution plan",
        mandatory: true,
        match: [
          ["meals", "distribution", "capacity"],
          ["5000", "5,000", "distribution", "plan", "per day"],
        ],
      },
      {
        id: "bbee",
        label: "B-BBEE certificate (PPPFA preference)",
        mandatory: true,
        match: [
          ["b-bbee", "bbee", "b bbee"],
          ["certificate", "preference", "pppfa"],
        ],
      },
      {
        id: "trade-refs",
        label: "Two trade references (desirable)",
        mandatory: false,
        match: [
          ["reference", "references"],
          ["two", "trade"],
        ],
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
        match: [
          ["grade c", "graded", "psira-graded"],
          ["officers", "grade", "schedule"],
        ],
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
        match: [
          ["minimum wage", "sectoral determination"],
          ["compliance", "minimum wage", "determination"],
        ],
      },
      {
        id: "public-liability",
        label: "Public liability insurance >= ZAR 10 million",
        mandatory: true,
        match: [
          ["public liability", "liability insurance"],
          ["10 million", "insurance"],
        ],
      },
      {
        id: "tax-pin",
        label: "Valid Tax Compliance Status PIN",
        mandatory: true,
        match: [
          ["tax compliance", "tax clearance"],
          ["pin", "status"],
        ],
      },
      {
        id: "control-room",
        label: "Control-room / incident-reporting capability (desirable)",
        mandatory: false,
        match: [
          ["control-room", "control room", "incident"],
          ["control room", "incident", "reporting"],
        ],
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
        match: [
          ["company registration", "registration", "tax clearance"],
          ["tax clearance", "certificate", "registration"],
        ],
      },
      {
        id: "water-licence",
        label: "Water-use authorisation / licence (National Water Act)",
        mandatory: true,
        match: [
          ["water-use", "water use", "national water act"],
          ["authorisation", "authorization", "licence", "license"],
        ],
      },
      {
        id: "bid-security",
        label: "Bid security ZAR 75,000 valid 90 days",
        mandatory: true,
        match: [
          ["bid security", "bid bond"],
          ["75", "90 days", "valid"],
        ],
      },
      {
        id: "technical-proposal",
        label: "Technical proposal with pump sizing and hydraulic design",
        mandatory: true,
        match: [
          ["technical proposal", "pump sizing", "hydraulic"],
          ["proposal", "calculations", "design", "sizing"],
        ],
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
        match: [
          ["installations", "installation", "similar"],
          ["three", "centre-pivot", "centre pivot"],
        ],
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
        match: [
          ["tax compliance", "tax clearance"],
          ["pin", "csd", "status"],
        ],
      },
      {
        id: "acceptability",
        label: "Certificate of Acceptability for laundry premises",
        mandatory: true,
        match: [
          ["acceptability", "premises"],
          ["certificate", "acceptability", "premises"],
        ],
      },
      {
        id: "infection-control",
        label: "Infection-control protocol (SANS 10146)",
        mandatory: true,
        match: [
          ["infection", "sans 10146", "sans"],
          ["control", "protocol", "10146"],
        ],
      },
      {
        id: "public-liability",
        label: "Public liability insurance >= ZAR 5 million",
        mandatory: true,
        match: [
          ["public liability", "liability insurance"],
          ["5 million", "insurance"],
        ],
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
        match: [
          ["collection", "delivery", "schedule", "turnaround"],
          ["24", "hour", "schedule", "turnaround"],
        ],
      },
      {
        id: "bbee",
        label: "B-BBEE verification certificate (desirable)",
        mandatory: false,
        match: [
          ["b-bbee", "bbee", "b bbee"],
          ["certificate", "verification"],
        ],
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
        match: [
          [
            "cac",
            "certificate of incorporation",
            "corporate affairs commission",
          ],
        ],
      },
      {
        id: "tax-clearance",
        label: "Tax clearance for the last three years",
        mandatory: true,
        match: [
          ["tax clearance", "tax compliance"],
          ["three", "3"],
        ],
      },
      {
        id: "pencom",
        label: "Current PENCOM compliance certificate",
        mandatory: true,
        match: [
          ["pencom", "pension"],
          ["compliance", "certificate"],
        ],
      },
      {
        id: "itf",
        label: "Current ITF compliance certificate",
        mandatory: true,
        match: [
          ["itf", "industrial training fund"],
          ["compliance", "certificate"],
        ],
      },
      {
        id: "nsitf",
        label: "Current NSITF compliance certificate",
        mandatory: true,
        match: [
          ["nsitf", "social insurance"],
          ["compliance", "certificate"],
        ],
      },
      {
        id: "bpp-database",
        label: "Registration on the BPP National Database of Contractors",
        mandatory: true,
        match: [
          ["bpp", "national database"],
          ["registration", "contractors"],
        ],
      },
      {
        id: "bid-security",
        label: "Bid security of 2% of the bid price from a reputable bank",
        mandatory: true,
        match: [
          ["bid security", "bid bond"],
          ["2", "two percent"],
        ],
      },
      {
        id: "bid-validity",
        label: "Bid valid for ninety days from bid opening",
        mandatory: true,
        match: [
          ["valid", "validity"],
          ["90", "ninety"],
        ],
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
        label:
          "NCDMB Nigerian Content Equipment Certificate or application evidence",
        mandatory: true,
        match: [["ncdmb", "ncec", "nigerian content equipment"]],
      },
      {
        id: "nc-plan",
        label:
          "Nigerian Content Plan demonstrating minimum 70% Nigerian content",
        mandatory: true,
        match: [["nigerian content plan"], ["70"]],
      },
      {
        id: "dpr-nuprc",
        label: "Certificate of registration with DPR / NUPRC",
        mandatory: true,
        match: [
          ["dpr", "nuprc", "department of petroleum"],
          ["registration", "certificate"],
        ],
      },
      {
        id: "vessels",
        label:
          "Ownership or bareboat charter of two DP2 platform supply vessels",
        mandatory: true,
        match: [
          ["dp2", "platform supply vessel"],
          ["two", "2"],
        ],
      },
      {
        id: "ism",
        label:
          "ISM Code Document of Compliance and Safety Management Certificate per vessel",
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
        match: [
          ["audited accounts", "audited financial"],
          ["three", "3"],
        ],
      },
      {
        id: "credit-line",
        label:
          "Bank reference letter and credit line of not less than N200,000,000",
        mandatory: true,
        match: [
          ["bank reference", "credit line", "financial capability"],
          ["200 000 000", "two hundred million"],
        ],
      },
      {
        id: "similar-projects",
        label:
          "Three similar road projects in the last five years with award letters and completion certificates",
        mandatory: true,
        match: [
          ["similar", "road projects"],
          ["three", "3"],
          ["five", "5"],
        ],
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
  {
    id: "NG-PHCDA-2026-021-consumables",
    title: "Supply of medical consumables to primary healthcare centres",
    documentText: `PRIMARY HEALTH CARE DEVELOPMENT AGENCY — TENDER NG-PHCDA-2026-021: MEDICAL CONSUMABLES

Section A: Eligibility
A1  Bidders MUST possess a valid CAC certificate of incorporation with certified true copies of Forms CAC 2 and CAC 7.
A2  Bidders MUST submit a current Tax Clearance Certificate for the three (3) preceding years expiring 31 December.
A3  Bidders MUST provide evidence of PENCOM compliance certificate valid through the current year.
A4  Bidders MUST submit an ITF compliance certificate.
A5  Bidders MUST provide a NAFDAC product registration certificate for every listed consumable.
A6  Bidders MUST submit an Interim Registration Report (IRR) or evidence of registration on the BPP National Database of Contractors.

Section B: Commercial
B1  A bid security of 2% of the bid sum issued by a bank or insurer approved by the Central Bank of Nigeria is mandatory.
B2  Bidders should submit evidence of similar supplies to public health institutions in the last five (5) years.`,
    groundTruth: [
      {
        id: "cac-forms",
        label: "CAC incorporation with Forms CAC 2 and CAC 7",
        mandatory: true,
        match: [
          ["cac", "incorporation"],
          ["cac 2", "cac 7", "certificate"],
        ],
      },
      {
        id: "tax-clearance",
        label: "Tax Clearance Certificate for three preceding years",
        mandatory: true,
        match: [["tax clearance"], ["three", "3", "years"]],
      },
      {
        id: "pencom",
        label: "PENCOM compliance certificate",
        mandatory: true,
        match: [["pencom"], ["compliance", "certificate"]],
      },
      {
        id: "itf",
        label: "ITF compliance certificate",
        mandatory: true,
        match: [["itf"], ["compliance", "certificate"]],
      },
      {
        id: "nafdac",
        label: "NAFDAC product registration for each consumable",
        mandatory: true,
        match: [["nafdac"], ["registration", "certificate", "product"]],
      },
      {
        id: "bpp-database",
        label: "IRR / BPP National Database of Contractors registration",
        mandatory: true,
        match: [
          ["irr", "interim registration", "national database"],
          ["bpp", "registration", "contractors"],
        ],
      },
      {
        id: "bid-security",
        label: "Bid security of 2% of bid sum (CBN-approved issuer)",
        mandatory: true,
        match: [
          ["bid security", "bid bond"],
          ["2%", "2 %", "central bank"],
        ],
      },
      {
        id: "similar-supplies",
        label: "Similar supplies to public health institutions (desirable)",
        mandatory: false,
        match: [["similar suppl"], ["five", "5", "years"]],
      },
    ],
  },
  {
    id: "NG-TCN-2026-108-substation",
    title: "Rehabilitation of a 132/33kV transmission substation",
    documentText: `TRANSMISSION COMPANY — TENDER NG-TCN-2026-108: 132/33KV SUBSTATION REHABILITATION

Clause 2.1  Bidders MUST be registered with the Corporate Affairs Commission and submit the certificate of incorporation.
Clause 2.2  Bidders MUST submit evidence of NSITF compliance certificate.
Clause 2.3  Bidders MUST provide audited financial statements for the last three (3) financial years signed by a licensed auditor.
Clause 2.4  Bidders MUST hold a valid electrical contractor licence issued by NEMSA in the appropriate class.
Clause 2.5  Bidders MUST submit a sworn affidavit disclosing whether any officer of the procuring entity is a former or present director or shareholder of the bidder.
Clause 3.1  Bidders MUST provide a method statement and outage management plan for works on energised networks.
Clause 3.2  Bidders should include CVs of the proposed project manager and lead protection engineer.`,
    groundTruth: [
      {
        id: "cac",
        label: "CAC certificate of incorporation",
        mandatory: true,
        match: [
          ["corporate affairs", "cac"],
          ["incorporation", "certificate"],
        ],
      },
      {
        id: "nsitf",
        label: "NSITF compliance certificate",
        mandatory: true,
        match: [["nsitf"], ["compliance", "certificate"]],
      },
      {
        id: "audited-accounts",
        label: "Audited financial statements, last three years",
        mandatory: true,
        match: [
          ["audited financial", "audited accounts"],
          ["three", "3"],
        ],
      },
      {
        id: "nemsa-licence",
        label: "NEMSA electrical contractor licence",
        mandatory: true,
        match: [["nemsa"], ["licence", "license", "contractor"]],
      },
      {
        id: "affidavit",
        label: "Sworn affidavit of disclosure (directors/shareholders)",
        mandatory: true,
        match: [["affidavit"], ["disclos", "director", "shareholder"]],
      },
      {
        id: "method-statement",
        label: "Method statement and outage management plan",
        mandatory: true,
        match: [
          ["method statement"],
          ["outage", "plan", "energised", "energized"],
        ],
      },
      {
        id: "cvs",
        label: "CVs of project manager and protection engineer (desirable)",
        mandatory: false,
        match: [
          ["cv", "cvs"],
          ["project manager", "protection engineer"],
        ],
      },
    ],
  },
  {
    id: "NG-UBEC-2026-055-classrooms",
    title:
      "Construction of classroom blocks under the basic education programme",
    documentText: `UNIVERSAL BASIC EDUCATION BOARD — TENDER NG-UBEC-2026-055: CLASSROOM BLOCKS

1.  Bidders MUST submit a certificate of incorporation with CAC status report not older than three (3) months.
2.  Bidders MUST submit current Tax Clearance, PENCOM, ITF and NSITF compliance certificates. Failure to provide any one shall render the bid non-responsive.
3.  Bidders MUST provide evidence of registration on the National Database of Federal Contractors (BPP) with an Interim Registration Report.
4.  Bidders MUST submit a company profile with verifiable evidence of at least two (2) completed building projects of similar scope, including letters of award and completion certificates.
5.  Bidders MUST provide a bank reference letter and evidence of financial capability of not less than NGN 50,000,000.
6.  Bidders MUST complete the priced Bill of Quantities in ink, sign every page, and shall not alter the quantities.
7.  Bidders should attach a work programme showing completion within twenty-six (26) weeks.`,
    groundTruth: [
      {
        id: "cac-status",
        label: "CAC incorporation + status report within 3 months",
        mandatory: true,
        match: [
          ["incorporation", "cac"],
          ["status report", "three", "3 months"],
        ],
      },
      {
        id: "statutory-certs",
        label: "Tax Clearance, PENCOM, ITF, NSITF certificates",
        mandatory: true,
        match: [["tax clearance"], ["pencom"], ["itf"], ["nsitf"]],
      },
      {
        id: "bpp-irr",
        label: "BPP National Database registration with IRR",
        mandatory: true,
        match: [
          ["national database", "bpp"],
          ["interim registration", "irr", "registration"],
        ],
      },
      {
        id: "similar-projects",
        label:
          "Two completed similar building projects with award/completion letters",
        mandatory: true,
        match: [
          ["two", "2"],
          ["completed", "similar"],
          ["award", "completion certificate"],
        ],
      },
      {
        id: "financial-capability",
        label: "Bank reference + financial capability >= NGN 50,000,000",
        mandatory: true,
        match: [
          ["bank reference"],
          ["50,000,000", "50000000", "financial capability"],
        ],
      },
      {
        id: "priced-boq",
        label: "Priced BOQ in ink, every page signed, quantities unaltered",
        mandatory: true,
        match: [
          ["bill of quantities", "boq"],
          ["ink", "sign", "signed"],
        ],
      },
      {
        id: "work-programme",
        label: "Work programme within 26 weeks (desirable)",
        mandatory: false,
        match: [
          ["work programme", "programme"],
          ["26", "twenty-six"],
        ],
      },
    ],
  },
  {
    id: "NG-NIPEX-2026-DR-0087-drilling",
    title: "Provision of drilling fluids and mud engineering services",
    documentText: `NIPEX TENDER NG-NIPEX-2026-DR-0087: DRILLING FLUIDS AND MUD ENGINEERING

ITT 4.1  Tenderers MUST be prequalified in the relevant NipeX product/service category and submit their NJQS certificate.
ITT 4.2  Tenderers MUST hold a valid DPR (NUPRC) permit for the service category.
ITT 4.3  Tenderers MUST submit a valid Nigerian Content Equipment Certificate or NCDMB NOGIC JQS registration evidence.
ITT 4.4  Tenderers MUST submit a Nigerian Content Plan demonstrating compliance with the NOGICD Act minimum levels.
ITT 5.1  Tenderers MUST provide an HSE policy and past three (3) years TRIR statistics.
ITT 5.2  Tenderers MUST confirm ability to provide a parent company guarantee where the tendering entity is a subsidiary.
ITT 6.1  Tenderers should provide details of in-country laboratory facilities for mud testing.`,
    groundTruth: [
      {
        id: "njqs",
        label: "NipeX NJQS prequalification certificate",
        mandatory: true,
        match: [
          ["njqs", "nipex"],
          ["prequalified", "certificate"],
        ],
      },
      {
        id: "regulator-permit",
        label: "Valid DPR/NUPRC permit",
        mandatory: true,
        match: [["dpr", "nuprc"], ["permit"]],
      },
      {
        id: "ncdmb",
        label:
          "Nigerian Content Equipment Certificate / NOGIC JQS registration",
        mandatory: true,
        match: [
          ["ncdmb", "nogic", "nigerian content equipment"],
          ["certificate", "registration", "jqs"],
        ],
      },
      {
        id: "nc-plan",
        label: "Nigerian Content Plan (NOGICD Act)",
        mandatory: true,
        match: [["nigerian content plan"], ["nogicd", "act", "compliance"]],
      },
      {
        id: "hse-trir",
        label: "HSE policy + three years TRIR statistics",
        mandatory: true,
        match: [["hse"], ["trir", "statistics", "three"]],
      },
      {
        id: "pcg",
        label: "Parent company guarantee confirmation",
        mandatory: true,
        match: [["parent company guarantee"], ["subsidiary", "confirm"]],
      },
      {
        id: "lab",
        label: "In-country mud-testing laboratory details (desirable)",
        mandatory: false,
        match: [
          ["laboratory", "lab"],
          ["in-country", "mud"],
        ],
      },
    ],
  },
  {
    id: "NG-FMWR-2026-042-boreholes",
    title: "Drilling of solar-powered boreholes in rural communities",
    documentText: `FEDERAL MINISTRY OF WATER RESOURCES — TENDER NG-FMWR-2026-042: SOLAR-POWERED BOREHOLES

C1  Bidders MUST submit evidence of company registration with CAC.
C2  Bidders MUST submit a current Tax Clearance Certificate reflecting annual turnover.
C3  Bidders MUST provide a valid borehole drillers licence issued by the relevant water regulatory authority.
C4  Bidders MUST submit evidence of ownership or lease of at least one (1) functional drilling rig, with photographs and registration papers.
C5  Bidders MUST provide a hydrogeological survey methodology and water quality testing plan referencing SON NIS 554 drinking water standard.
C6  A bid security of NGN 2,500,000 in the form of a bank guarantee is mandatory and must remain valid for 120 days.
C7  Bidders should describe a community handover and maintenance training plan.`,
    groundTruth: [
      {
        id: "cac",
        label: "CAC company registration",
        mandatory: true,
        match: [["cac", "company registration"], ["registration"]],
      },
      {
        id: "tax",
        label: "Current Tax Clearance Certificate",
        mandatory: true,
        match: [["tax clearance"], ["certificate", "current"]],
      },
      {
        id: "drillers-licence",
        label: "Borehole drillers licence",
        mandatory: true,
        match: [
          ["drillers licence", "drillers license", "borehole"],
          ["licence", "license"],
        ],
      },
      {
        id: "rig",
        label: "Ownership/lease of a functional drilling rig with evidence",
        mandatory: true,
        match: [
          ["drilling rig", "rig"],
          ["ownership", "lease", "photograph"],
        ],
      },
      {
        id: "hydro-survey",
        label:
          "Hydrogeological survey methodology + NIS 554 water quality plan",
        mandatory: true,
        match: [["hydrogeological"], ["nis 554", "water quality", "son"]],
      },
      {
        id: "bid-security",
        label: "Bid security NGN 2,500,000 bank guarantee, 120 days",
        mandatory: true,
        match: [
          ["bid security", "bank guarantee"],
          ["2,500,000", "120 days"],
        ],
      },
      {
        id: "handover",
        label: "Community handover and maintenance training plan (desirable)",
        mandatory: false,
        match: [["handover", "maintenance training"], ["community"]],
      },
    ],
  },
  {
    id: "NG-FIRS-2026-077-ict",
    title: "Supply and deployment of data-centre infrastructure",
    documentText: `REVENUE SERVICE — TENDER NG-FIRS-2026-077: DATA CENTRE INFRASTRUCTURE

D1  Bidders MUST submit certificate of incorporation and CAC forms showing current directors.
D2  Bidders MUST submit valid Tax Clearance, PENCOM, ITF and NSITF certificates.
D3  Bidders MUST be registered with NITDA as an indigenous ICT company or partner with one, evidenced by a registration certificate.
D4  Bidders MUST provide OEM authorisation letters for all proposed hardware, addressed to this tender by reference number.
D5  Bidders MUST submit evidence of at least two (2) Tier III data-centre deployments with client references.
D6  Bidders MUST include a three (3) year on-site support and SLA proposal with guaranteed 99.98% availability.
D7  Bidders should include ISO 27001 certification of their managed-services operation.`,
    groundTruth: [
      {
        id: "cac-directors",
        label: "Incorporation certificate + CAC forms with current directors",
        mandatory: true,
        match: [["incorporation", "cac"], ["directors"]],
      },
      {
        id: "statutory",
        label: "Tax Clearance, PENCOM, ITF, NSITF certificates",
        mandatory: true,
        match: [["tax clearance"], ["pencom"], ["itf"], ["nsitf"]],
      },
      {
        id: "nitda",
        label: "NITDA indigenous ICT registration (or partner)",
        mandatory: true,
        match: [["nitda"], ["registration", "indigenous", "certificate"]],
      },
      {
        id: "oem-letters",
        label: "OEM authorisation letters referencing this tender",
        mandatory: true,
        match: [["oem"], ["authorisation", "authorization", "letter"]],
      },
      {
        id: "tier-iii",
        label: "Two Tier III data-centre deployments with references",
        mandatory: true,
        match: [
          ["tier iii", "tier 3"],
          ["two", "2", "deployments"],
        ],
      },
      {
        id: "sla",
        label: "Three-year support/SLA at 99.98% availability",
        mandatory: true,
        match: [
          ["sla", "service level"],
          ["99.98", "availability"],
        ],
      },
      {
        id: "iso27001",
        label: "ISO 27001 certification (desirable)",
        mandatory: false,
        match: [["iso 27001", "27001"]],
      },
    ],
  },
  {
    id: "NG-NDDC-2026-019-shoreline",
    title: "Shoreline protection and reclamation works",
    documentText: `NIGER DELTA DEVELOPMENT COMMISSION — TENDER NG-NDDC-2026-019: SHORELINE PROTECTION

S1  Bidders MUST submit CAC incorporation documents and a sworn affidavit that the company is not in receivership.
S2  Bidders MUST submit three (3) years Tax Clearance and audited accounts.
S3  Bidders MUST provide a current COREN registration for the lead civil engineer.
S4  Bidders MUST submit an Environmental Impact Assessment compliance plan referencing the EIA Act.
S5  Bidders MUST provide evidence of ownership or lease agreements for marine plant (dredgers, barges) intended for the works.
S6  A bid security of 2% of the bid price from a reputable bank is mandatory; bids without it shall be rejected.
S7  Bidders MUST attend the mandatory pre-bid site visit; a site meeting attendance certificate will be issued.
S8  Bidders should include a community relations and local employment plan.`,
    groundTruth: [
      {
        id: "cac-affidavit",
        label: "CAC incorporation + affidavit of no receivership",
        mandatory: true,
        match: [
          ["cac", "incorporation"],
          ["affidavit", "receivership"],
        ],
      },
      {
        id: "tax-audited",
        label: "Three years Tax Clearance and audited accounts",
        mandatory: true,
        match: [["tax clearance"], ["audited", "accounts", "three"]],
      },
      {
        id: "coren",
        label: "COREN registration for lead civil engineer",
        mandatory: true,
        match: [["coren"], ["engineer", "registration"]],
      },
      {
        id: "eia",
        label: "EIA compliance plan",
        mandatory: true,
        match: [
          ["environmental impact", "eia"],
          ["compliance", "plan", "act"],
        ],
      },
      {
        id: "marine-plant",
        label: "Ownership/lease of marine plant (dredgers, barges)",
        mandatory: true,
        match: [
          ["dredger", "barge", "marine plant"],
          ["ownership", "lease"],
        ],
      },
      {
        id: "bid-security",
        label: "Bid security 2% of bid price",
        mandatory: true,
        match: [
          ["bid security", "bid bond"],
          ["2%", "2 %"],
        ],
      },
      {
        id: "site-visit",
        label: "Mandatory pre-bid site visit attendance",
        mandatory: true,
        match: [["site visit"], ["mandatory", "attendance", "pre-bid"]],
      },
      {
        id: "community-plan",
        label: "Community relations and local employment plan (desirable)",
        mandatory: false,
        match: [["community relations", "local employment"]],
      },
    ],
  },
  {
    id: "NG-DSS-2026-090-catering",
    title: "Provision of catering services for a training institution",
    documentText: `FEDERAL TRAINING INSTITUTION — TENDER NG-DSS-2026-090: CATERING SERVICES

K1  Bidders MUST submit evidence of registration with the CAC.
K2  Bidders MUST provide a current Tax Clearance Certificate and evidence of VAT registration with FIRS (TIN).
K3  Bidders MUST hold valid food-handler medical certificates for all serving staff, renewable every six (6) months.
K4  Bidders MUST provide a NAFDAC-compliant food safety and hygiene plan (HACCP based).
K5  Bidders MUST submit evidence of at least two (2) institutional catering contracts of not less than 500 covers per day.
K6  Bidders MUST provide a sample four (4) week menu cycle priced per head in Naira.
K7  Bidders should provide staff training records for food safety in the last twelve (12) months.`,
    groundTruth: [
      {
        id: "cac",
        label: "CAC registration",
        mandatory: true,
        match: [["cac"], ["registration"]],
      },
      {
        id: "tax-vat",
        label: "Tax Clearance + VAT/TIN registration with FIRS",
        mandatory: true,
        match: [["tax clearance"], ["vat", "tin", "firs"]],
      },
      {
        id: "food-handler",
        label: "Food-handler medical certificates (6-monthly)",
        mandatory: true,
        match: [
          ["food-handler", "food handler", "medical certificate"],
          ["six", "6", "months"],
        ],
      },
      {
        id: "haccp",
        label: "NAFDAC-compliant food safety plan (HACCP)",
        mandatory: true,
        match: [
          ["haccp", "food safety"],
          ["nafdac", "hygiene", "plan"],
        ],
      },
      {
        id: "contracts",
        label: "Two institutional catering contracts >= 500 covers/day",
        mandatory: true,
        match: [
          ["institutional catering", "catering contract"],
          ["500", "two", "2"],
        ],
      },
      {
        id: "menu",
        label: "Priced four-week menu cycle in Naira",
        mandatory: true,
        match: [["menu"], ["four", "4", "week"]],
      },
      {
        id: "training-records",
        label: "Food-safety training records (desirable)",
        mandatory: false,
        match: [
          ["training records", "training"],
          ["twelve", "12", "months"],
        ],
      },
    ],
  },
  {
    id: "NG-NNPC-2026-PL-033-pipeline",
    title: "Pipeline right-of-way surveillance and integrity patrols",
    documentText: `PIPELINE OPERATOR — TENDER NG-NNPC-2026-PL-033: RIGHT-OF-WAY SURVEILLANCE

P1  Tenderers MUST submit CAC incorporation documents and current NJQS product code registration.
P2  Tenderers MUST provide a valid private guard company licence issued by the Nigeria Security and Civil Defence Corps (NSCDC).
P3  Tenderers MUST submit a Nigerian Content Plan and evidence of NOGIC JQS registration.
P4  Tenderers MUST provide a communications and incident escalation matrix with guaranteed thirty (30) minute reporting of confirmed encroachment.
P5  Tenderers MUST provide evidence of a functional operations base within the right-of-way corridor states.
P6  Tenderers MUST submit three (3) years audited accounts and insurance covering personnel deployed on patrols.
P7  Tenderers should describe community engagement arrangements with host communities along the corridor.`,
    groundTruth: [
      {
        id: "cac-njqs",
        label: "CAC incorporation + NJQS product code registration",
        mandatory: true,
        match: [["cac", "incorporation"], ["njqs"]],
      },
      {
        id: "nscdc",
        label: "NSCDC private guard company licence",
        mandatory: true,
        match: [
          ["nscdc", "civil defence"],
          ["licence", "license", "guard"],
        ],
      },
      {
        id: "nc-plan",
        label: "Nigerian Content Plan + NOGIC JQS registration",
        mandatory: true,
        match: [["nigerian content"], ["nogic", "jqs", "registration"]],
      },
      {
        id: "escalation",
        label: "Incident escalation matrix, 30-minute reporting",
        mandatory: true,
        match: [
          ["escalation", "incident"],
          ["thirty", "30", "minute"],
        ],
      },
      {
        id: "ops-base",
        label: "Functional operations base within corridor states",
        mandatory: true,
        match: [
          ["operations base", "base"],
          ["corridor", "states"],
        ],
      },
      {
        id: "accounts-insurance",
        label: "Three years audited accounts + patrol personnel insurance",
        mandatory: true,
        match: [["audited accounts", "audited"], ["insurance"]],
      },
      {
        id: "community",
        label: "Host community engagement (desirable)",
        mandatory: false,
        match: [["community engagement", "host communities"]],
      },
    ],
  },
  {
    id: "NG-REA-2026-064-minigrid",
    title: "Design, supply and installation of solar hybrid mini-grids",
    documentText: `RURAL ELECTRIFICATION AGENCY — TENDER NG-REA-2026-064: SOLAR HYBRID MINI-GRIDS

M1  Bidders MUST submit certificate of incorporation, Tax Clearance, PENCOM, ITF and NSITF certificates.
M2  Bidders MUST provide a NERC mini-grid permit or evidence of a pending application acknowledged by NERC.
M3  Bidders MUST submit manufacturer authorisation and IEC type-test certificates for PV modules and inverters.
M4  Bidders MUST submit a single-line diagram and energy yield assessment for each site, prepared by a COREN-registered engineer.
M5  Bidders MUST provide evidence of one (1) completed mini-grid of at least 100kWp in sub-Saharan Africa.
M6  A bid security of NGN 5,000,000 is mandatory, valid for ninety (90) days beyond bid validity.
M7  Bidders should include a five (5) year operations and maintenance proposal with local technician training.`,
    groundTruth: [
      {
        id: "statutory",
        label: "Incorporation + Tax/PENCOM/ITF/NSITF certificates",
        mandatory: true,
        match: [["incorporation"], ["tax clearance"], ["pencom"]],
      },
      {
        id: "nerc",
        label: "NERC mini-grid permit or acknowledged application",
        mandatory: true,
        match: [["nerc"], ["permit", "application"]],
      },
      {
        id: "iec-certs",
        label: "Manufacturer authorisation + IEC type-test certificates",
        mandatory: true,
        match: [["iec"], ["type-test", "type test", "manufacturer"]],
      },
      {
        id: "sld-yield",
        label: "Single-line diagram + energy yield by COREN engineer",
        mandatory: true,
        match: [
          ["single-line", "single line"],
          ["energy yield", "coren"],
        ],
      },
      {
        id: "track-record",
        label: "One completed >=100kWp mini-grid in sub-Saharan Africa",
        mandatory: true,
        match: [
          ["100kwp", "100 kwp", "mini-grid"],
          ["completed", "one", "1"],
        ],
      },
      {
        id: "bid-security",
        label: "Bid security NGN 5,000,000, 90 days beyond validity",
        mandatory: true,
        match: [["bid security"], ["5,000,000", "ninety", "90"]],
      },
      {
        id: "om-proposal",
        label: "Five-year O&M with technician training (desirable)",
        mandatory: false,
        match: [
          ["operations and maintenance", "o&m", "maintenance"],
          ["five", "5", "year"],
        ],
      },
    ],
  },
  {
    id: "NG-FAAN-2026-112-groundhandling",
    title: "Concession of ground support equipment maintenance services",
    documentText: `AIRPORTS AUTHORITY — TENDER NG-FAAN-2026-112: GSE MAINTENANCE SERVICES

G1  Bidders MUST submit CAC incorporation documents, Tax Clearance and evidence of remittance of statutory pensions.
G2  Bidders MUST hold a valid NCAA approval or authorisation relevant to ground support operations.
G3  Bidders MUST provide OEM training certificates for technicians on at least two (2) GSE families in the fleet list.
G4  Bidders MUST provide an aviation-specific liability insurance certificate of not less than USD 1,000,000 or Naira equivalent.
G5  Bidders MUST submit a spare-parts sourcing plan with guaranteed AOG response of four (4) hours at the designated airports.
G6  Bidders MUST complete the priced schedule in the exact format provided; altered formats shall be rejected as non-responsive.
G7  Bidders should describe an apprenticeship arrangement with a recognised aviation training institution.`,
    groundTruth: [
      {
        id: "cac-tax",
        label: "CAC incorporation + Tax Clearance + pension remittance",
        mandatory: true,
        match: [["cac", "incorporation"], ["tax clearance"], ["pension"]],
      },
      {
        id: "ncaa",
        label: "NCAA approval/authorisation for ground support",
        mandatory: true,
        match: [["ncaa"], ["approval", "authorisation", "authorization"]],
      },
      {
        id: "oem-training",
        label: "OEM technician training on two GSE families",
        mandatory: true,
        match: [["oem"], ["training", "technician"], ["two", "2"]],
      },
      {
        id: "insurance",
        label: "Aviation liability insurance >= USD 1,000,000",
        mandatory: true,
        match: [
          ["liability insurance", "insurance"],
          ["1,000,000", "usd"],
        ],
      },
      {
        id: "aog",
        label: "Spare-parts plan with 4-hour AOG response",
        mandatory: true,
        match: [
          ["aog", "spare-parts", "spare parts"],
          ["four", "4", "hour"],
        ],
      },
      {
        id: "priced-schedule",
        label: "Priced schedule in exact format (alterations non-responsive)",
        mandatory: true,
        match: [
          ["priced schedule", "exact format"],
          ["non-responsive", "rejected", "altered"],
        ],
      },
      {
        id: "apprenticeship",
        label: "Apprenticeship with aviation training institution (desirable)",
        mandatory: false,
        match: [["apprenticeship"], ["training institution"]],
      },
    ],
  },
];
