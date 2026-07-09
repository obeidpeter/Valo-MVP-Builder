/**
 * Eval harness v0 corpus (FR-EXT-05 / TRD §9 / Roadmap §5.1).
 *
 * Twelve hand-labelled tender documents: each case carries the tender text
 * the engine sees and the ground-truth requirement list a careful human
 * reviewer would confirm from it. The labelled sets are the yardstick —
 * "mandatory recall" for a run is measured against `labelled` items with
 * isMandatory=true (definitions fixed in scoring.ts, per TRD §14).
 *
 * Grow this corpus (≥25 documents by v1.0) from REAL delivered engagements:
 * after each autopsy, add an anonymised excerpt + the reviewer-confirmed
 * requirement list. Never edit existing labels to make a run pass — that is
 * the one forbidden move; fix the engine or record the miss.
 */

export interface LabelledRequirement {
  text: string;
  isMandatory: boolean;
}

export interface EvalCase {
  id: string;
  title: string;
  documentText: string;
  labelled: LabelledRequirement[];
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "fmoh-lab-equipment",
    title: "Federal goods tender — laboratory equipment",
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
    labelled: [
      { text: "valid CAC certificate of incorporation", isMandatory: true },
      { text: "tax clearance for the last three years", isMandatory: true },
      { text: "current PENCOM compliance certificate", isMandatory: true },
      { text: "current ITF compliance certificate", isMandatory: true },
      { text: "current NSITF compliance certificate", isMandatory: true },
      { text: "registration on the BPP National Database of Contractors", isMandatory: true },
      { text: "bid security of two percent of the bid price from a reputable bank", isMandatory: true },
      { text: "bid valid for ninety days from bid opening", isMandatory: true },
      { text: "brochures of the offered equipment", isMandatory: false },
      { text: "one original and two copies clearly marked", isMandatory: true },
    ],
  },
  {
    id: "fmw-road-works",
    title: "Federal works tender — road rehabilitation",
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
    labelled: [
      { text: "certificate of incorporation with CAC including forms CAC2 and CAC7", isMandatory: true },
      { text: "audited accounts for the last three years", isMandatory: true },
      { text: "bank reference letter and credit line of not less than N200,000,000", isMandatory: true },
      { text: "evidence of at least three similar road projects in the last five years with award letters and completion certificates", isMandatory: true },
      { text: "list of construction equipment with proof of ownership or lease", isMandatory: true },
      { text: "COREN-registered civil engineer as project manager with 10 years experience", isMandatory: true },
      { text: "sworn affidavit disclosing ministry officers as directors", isMandatory: true },
      { text: "technical and financial bids in two separate sealed envelopes in one outer envelope", isMandatory: true },
      { text: "site visit before bid submission", isMandatory: false },
    ],
  },
  {
    id: "nipex-marine-logistics",
    title: "NIPEX oil & gas — marine logistics services",
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
    labelled: [
      { text: "registration and valid categorisation on NJQS in product code 3.99.12", isMandatory: true },
      { text: "valid NCDMB Nigerian Content Equipment Certificate or evidence of application", isMandatory: true },
      { text: "Nigerian Content Plan demonstrating minimum 70% Nigerian content", isMandatory: true },
      { text: "certificate of registration with DPR / NUPRC", isMandatory: true },
      { text: "ownership or bareboat charter of at least two DP2 platform supply vessels not older than 15 years", isMandatory: true },
      { text: "valid ISM Code Document of Compliance and Safety Management Certificate per vessel", isMandatory: true },
      { text: "HSE statistics for the last three years including LTIF and TRIR", isMandatory: true },
      { text: "attend the virtual clarification session", isMandatory: false },
    ],
  },
  {
    id: "donor-consultancy",
    title: "Donor-funded consultancy — REOI",
    documentText: `REQUEST FOR EXPRESSIONS OF INTEREST — CONSULTANCY FOR BASELINE SURVEY (World Bank financed).
The consultant shall be selected in accordance with the Consultant Qualification Selection method.
Interested consultants must provide:
(i) Company profile including legal status and country of registration.
(ii) Description of at least two (2) similar baseline survey assignments completed in the last seven (7) years, with client contact references.
(iii) CVs of proposed key experts: Team Leader (minimum a masters degree in statistics or economics and 8 years experience) and a Data Analyst.
(iv) Evidence of a functional office in Nigeria.
(v) A conflict of interest declaration in the format of Annex 2.
Expressions of interest must be delivered in written form to the address below by 14:00 hours on the deadline date.
Consultants may associate with other firms to enhance their qualifications; the form of association must be stated.`,
    labelled: [
      { text: "company profile including legal status and country of registration", isMandatory: true },
      { text: "two similar baseline survey assignments in the last seven years with client references", isMandatory: true },
      { text: "CV of team leader with masters degree in statistics or economics and 8 years experience", isMandatory: true },
      { text: "CV of data analyst", isMandatory: true },
      { text: "evidence of a functional office in Nigeria", isMandatory: true },
      { text: "conflict of interest declaration in the format of Annex 2", isMandatory: true },
      { text: "delivery in written form by 14:00 on the deadline date", isMandatory: true },
      { text: "form of association stated if associating with other firms", isMandatory: false },
    ],
  },
  {
    id: "state-ict-supply",
    title: "State goods tender — ICT equipment",
    documentText: `KADUNA STATE GOVERNMENT — SUPPLY OF ICT EQUIPMENT TO 45 SECONDARY SCHOOLS.
Mandatory documents:
1. Certificate of registration with the Kaduna State Public Procurement Authority.
2. CAC certificate of incorporation.
3. Current tax clearance certificate (three years) valid till 31st December.
4. Evidence of VAT registration and remittances.
5. Sworn affidavit that the company is not in receivership and no director has been convicted of fraud.
6. Original equipment manufacturer (OEM) authorisation letter for the quoted brands.
7. Warranty statement: minimum of twelve (12) months on all supplied items.
8. Delivery schedule not exceeding eight (8) weeks from contract signature.
Bidders may include additional value-added services which shall be considered during evaluation.`,
    labelled: [
      { text: "certificate of registration with the Kaduna State Public Procurement Authority", isMandatory: true },
      { text: "CAC certificate of incorporation", isMandatory: true },
      { text: "current tax clearance certificate for three years", isMandatory: true },
      { text: "evidence of VAT registration and remittances", isMandatory: true },
      { text: "sworn affidavit of no receivership and no director convicted of fraud", isMandatory: true },
      { text: "OEM authorisation letter for the quoted brands", isMandatory: true },
      { text: "warranty statement minimum twelve months", isMandatory: true },
      { text: "delivery schedule not exceeding eight weeks", isMandatory: true },
      { text: "additional value-added services", isMandatory: false },
    ],
  },
  {
    id: "ncdmb-fabrication",
    title: "NCDMB-scoped fabrication subcontract",
    documentText: `INVITATION TO TENDER — FABRICATION OF PRESSURE VESSELS (NCDMB Scope).
Technical submission requirements:
A. ASME U-stamp certification or evidence of partnership with a U-stamp holder.
B. Welding procedure specifications (WPS) and procedure qualification records (PQR) for carbon steel per ASME IX.
C. Valid NCDMB Expatriate Quota utilisation report where expatriates are proposed.
D. Fabrication yard: evidence of a yard in Nigeria with minimum 5,000 sqm covered area, with photographs and title or lease documents.
E. Quality management: ISO 9001:2015 certificate covering fabrication activities.
F. A detailed project execution plan including a level-2 schedule.
G. Insurance: evidence of workmen's compensation and third-party liability insurance.
Bidders are advised to review the draft subcontract terms in Annex D.`,
    labelled: [
      { text: "ASME U-stamp certification or partnership with a U-stamp holder", isMandatory: true },
      { text: "welding procedure specifications and procedure qualification records per ASME IX", isMandatory: true },
      { text: "NCDMB expatriate quota utilisation report where expatriates proposed", isMandatory: true },
      { text: "fabrication yard in Nigeria minimum 5,000 sqm covered with photographs and title or lease documents", isMandatory: true },
      { text: "ISO 9001:2015 certificate covering fabrication", isMandatory: true },
      { text: "detailed project execution plan including level-2 schedule", isMandatory: true },
      { text: "workmen's compensation and third-party liability insurance", isMandatory: true },
      { text: "review draft subcontract terms in Annex D", isMandatory: false },
    ],
  },
  {
    id: "power-transmission",
    title: "TCN transmission line works",
    documentText: `TRANSMISSION COMPANY OF NIGERIA — CONSTRUCTION OF 132kV TRANSMISSION LINE (LOT 3).
Qualification requirements:
1. Average annual construction turnover of N1,500,000,000 over the last five (5) years, supported by audited accounts.
2. Experience as prime contractor on at least two (2) transmission line projects of 132kV or higher in the last ten (10) years.
3. Liquid assets or credit facilities of not less than N400,000,000 net of other contractual commitments.
4. A litigation history statement covering the last five (5) years.
5. Manufacturer's test certificates for towers, conductors and insulators shall be submitted before installation (post-award condition).
6. Bid security: N50,000,000 in the format of Section IX.
7. Domestic bidders claiming margin of preference must submit evidence of majority Nigerian ownership.
8. The completed Bill of Quantities, priced in Naira, with unit rates in both figures and words.`,
    labelled: [
      { text: "average annual construction turnover of N1,500,000,000 over five years supported by audited accounts", isMandatory: true },
      { text: "prime contractor experience on two transmission line projects of 132kV or higher in ten years", isMandatory: true },
      { text: "liquid assets or credit facilities of not less than N400,000,000", isMandatory: true },
      { text: "litigation history statement covering five years", isMandatory: true },
      { text: "bid security of N50,000,000 in the format of Section IX", isMandatory: true },
      { text: "evidence of majority Nigerian ownership for margin of preference", isMandatory: false },
      { text: "completed bill of quantities priced in naira with unit rates in figures and words", isMandatory: true },
    ],
  },
  {
    id: "health-nfm-grant",
    title: "Global Fund sub-recipient selection",
    documentText: `CALL FOR APPLICATIONS — SUB-RECIPIENT FOR MALARIA PROGRAMME (Global Fund NFM4).
Applicant organisations must submit:
1. Evidence of registration in Nigeria as an NGO/CSO (CAC certificate with constitution).
2. Audited financial statements for the last two (2) years.
3. Organisational chart and CVs of the finance officer and programme manager.
4. Evidence of prior management of donor funds of at least USD 500,000 in a single grant.
5. A safeguarding policy and an anti-fraud policy, both board-approved.
6. Bank account details with two signatories, confirmed by the bank.
7. Applications shall be submitted electronically as a single PDF not exceeding 20MB.
Applicants shortlisted will be subject to a capacity assessment visit.`,
    labelled: [
      { text: "registration in Nigeria as NGO/CSO with CAC certificate and constitution", isMandatory: true },
      { text: "audited financial statements for the last two years", isMandatory: true },
      { text: "organisational chart and CVs of finance officer and programme manager", isMandatory: true },
      { text: "prior management of donor funds of at least USD 500,000 in a single grant", isMandatory: true },
      { text: "board-approved safeguarding policy and anti-fraud policy", isMandatory: true },
      { text: "bank account details with two signatories confirmed by the bank", isMandatory: true },
      { text: "electronic submission as a single PDF not exceeding 20MB", isMandatory: true },
    ],
  },
  {
    id: "facility-management",
    title: "Facility management services — framework",
    documentText: `TENDER FOR INTEGRATED FACILITY MANAGEMENT SERVICES — HEAD OFFICE COMPLEX.
Submission checklist:
(a) Company registration documents including CAC status report not older than six (6) months.
(b) Three (3) years tax clearance and PAYE remittance evidence for staff.
(c) Current facility management professional registration (IFMA or equivalent) for the lead manager.
(d) Reference letters from at least two (2) corporate clients of similar size, on client letterhead.
(e) A staffing plan showing supervisor-to-cleaner ratios and shift coverage.
(f) Method statement for handling hazardous cleaning chemicals with MSDS sheets.
(g) Proposed service level agreement with response-time commitments.
(h) Bidders may propose optional energy-efficiency add-on services.
Late submissions will be rejected without exception.`,
    labelled: [
      { text: "CAC status report not older than six months", isMandatory: true },
      { text: "three years tax clearance and PAYE remittance evidence", isMandatory: true },
      { text: "facility management professional registration for the lead manager", isMandatory: true },
      { text: "reference letters from two corporate clients on client letterhead", isMandatory: true },
      { text: "staffing plan with supervisor-to-cleaner ratios and shift coverage", isMandatory: true },
      { text: "method statement for hazardous chemicals with MSDS sheets", isMandatory: true },
      { text: "proposed service level agreement with response times", isMandatory: true },
      { text: "optional energy-efficiency add-on services", isMandatory: false },
    ],
  },
  {
    id: "agric-inputs",
    title: "Agricultural inputs supply — emergency procurement",
    documentText: `EMERGENCY PROCUREMENT NOTICE — SUPPLY OF FERTILISER AND IMPROVED SEEDLINGS.
Given the emergency nature, the following abridged requirements apply:
1. CAC certificate and one (1) year tax clearance only.
2. NAFDAC / relevant regulatory certification for all agro-chemical products quoted.
3. Evidence of at least one (1) prior supply of agricultural inputs to a government agency, with delivery certificate.
4. Samples of seedlings shall be submitted with the bid for laboratory viability testing.
5. Guaranteed delivery within twenty-one (21) days to the six (6) designated zonal warehouses.
6. Prices shall be fixed and not subject to escalation for the contract duration.
Bidders are reminded that supply of substandard inputs attracts prosecution under the relevant laws.`,
    labelled: [
      { text: "CAC certificate and one year tax clearance", isMandatory: true },
      { text: "NAFDAC or regulatory certification for agro-chemical products", isMandatory: true },
      { text: "one prior supply of agricultural inputs to a government agency with delivery certificate", isMandatory: true },
      { text: "samples of seedlings submitted for laboratory viability testing", isMandatory: true },
      { text: "guaranteed delivery within twenty-one days to six zonal warehouses", isMandatory: true },
      { text: "fixed prices not subject to escalation", isMandatory: true },
    ],
  },
  {
    id: "security-services",
    title: "Guard services — restricted tender",
    documentText: `RESTRICTED TENDER — PROVISION OF UNARMED SECURITY GUARD SERVICES.
Requirements:
1. Valid licence from the Nigeria Security and Civil Defence Corps (NSCDC) for private guard companies.
2. Evidence of remittance of employee pension and NSITF contributions for the last twelve (12) months.
3. Minimum of one hundred (100) guards currently in employment, with a staff list bearing designation.
4. Two (2) referee letters from current clients where at least twenty (20) guards are deployed.
5. A training curriculum for guards, including refresher cadence.
6. Certificate of insurance: fidelity guarantee covering theft by deployed staff.
7. The financial bid shall state the monthly cost per guard and the total annual cost, VAT inclusive.
Interviews of proposed supervisors may be conducted during evaluation.`,
    labelled: [
      { text: "valid NSCDC licence for private guard companies", isMandatory: true },
      { text: "pension and NSITF remittance for the last twelve months", isMandatory: true },
      { text: "minimum one hundred guards in employment with staff list", isMandatory: true },
      { text: "two referee letters from clients with at least twenty guards deployed", isMandatory: true },
      { text: "training curriculum including refresher cadence", isMandatory: true },
      { text: "fidelity guarantee insurance covering theft by deployed staff", isMandatory: true },
      { text: "financial bid stating monthly cost per guard and total annual cost VAT inclusive", isMandatory: true },
    ],
  },
  {
    id: "water-borehole",
    title: "Rural water scheme — solar boreholes",
    documentText: `COMMUNITY WATER PROJECT — DRILLING OF 12 SOLAR-POWERED BOREHOLES.
Bidder obligations:
(a) Registration with the state Ministry of Water Resources as a licensed drilling contractor.
(b) Geophysical survey reports shall be produced per site before drilling (deliverable, to be priced).
(c) Equipment: minimum one (1) DTH drilling rig of at least 200m capacity, with evidence of ownership.
(d) Personnel: a licensed hydrogeologist (COMEG registered) and a solar installation engineer.
(e) Water quality test certificates from a NAFDAC-recognised laboratory shall be provided per borehole before handover.
(f) A two (2) year defect liability commitment on pumps and solar arrays.
(g) Community engagement plan describing how host communities will be sensitised.
Tender documents are obtainable upon payment of a non-refundable fee of N25,000.`,
    labelled: [
      { text: "registration with the state Ministry of Water Resources as licensed drilling contractor", isMandatory: true },
      { text: "one DTH drilling rig of at least 200m capacity with evidence of ownership", isMandatory: true },
      { text: "licensed COMEG-registered hydrogeologist and solar installation engineer", isMandatory: true },
      { text: "two year defect liability commitment on pumps and solar arrays", isMandatory: true },
      { text: "community engagement plan", isMandatory: true },
      { text: "payment of non-refundable tender fee of N25,000", isMandatory: true },
      { text: "geophysical survey reports per site before drilling", isMandatory: false },
    ],
  },
  {
    id: "insurance-brokerage",
    title: "Insurance brokerage services — financial services tender",
    documentText: `REQUEST FOR PROPOSALS — GROUP LIFE AND ASSET INSURANCE BROKERAGE.
Proposal requirements:
1. Valid NAICOM registration as an insurance broker with current licence.
2. Membership certificate of the Nigerian Council of Registered Insurance Brokers (NCRIB).
3. Professional indemnity cover of not less than N100,000,000, with evidence of premium payment.
4. Audited accounts for the last three (3) years showing minimum gross premium handled of N500,000,000 annually.
5. Names and NAICOM-registration evidence of at least two (2) qualified brokers on staff.
6. A service charter covering claims-processing turnaround commitments.
7. Disclosure of any ownership relationship with underwriters being recommended.
Proposals shall be submitted in hard copy only; electronic submissions will not be accepted.`,
    labelled: [
      { text: "valid NAICOM registration as insurance broker with current licence", isMandatory: true },
      { text: "NCRIB membership certificate", isMandatory: true },
      { text: "professional indemnity cover of not less than N100,000,000 with premium payment evidence", isMandatory: true },
      { text: "audited accounts for three years showing minimum gross premium of N500,000,000 annually", isMandatory: true },
      { text: "two qualified NAICOM-registered brokers on staff", isMandatory: true },
      { text: "service charter with claims-processing turnaround commitments", isMandatory: true },
      { text: "disclosure of ownership relationship with recommended underwriters", isMandatory: true },
      { text: "hard copy submission only", isMandatory: true },
    ],
  },
];
