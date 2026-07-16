/* =====================================================================
   07_seed_reference.sql
   ---------------------------------------------------------------------
   Reference data for the tables the team maintains. The rows below are
   illustrative and show the required structure and an example of each
   pattern (multi-queue process, retired VDI, mid-life rate changes, a
   grade rate card pay award). The team populates these tables with the
   live estate values before first production use, and maintains them
   thereafter as the estate changes.

   KEEP IN STEP with data/reference/reference.json in the dashboard repo:
   that file is this script's JSON twin and drives the mock/demo pipeline.
   In particular, the RefPeopleCostHistory block below must stay an exact
   mirror of reference.json's peopleCostHistory[] array (same rows, same
   values) — see PLAYBOOK.md section 4 for the sync loop.

   This file is safe to re-run: it clears and repopulates the Ref tables
   and does NOT touch the fact table.

   HUB & SPOKE OWNERSHIP:
     Hub owns:    RefSpoke, RefGradeRate (the rate card), RefVDICostHistory
                  (per-class VDI £, universally true), RefEstateCostHistory
                  (working assumptions; TeamAnnualCostGBP is schema-parity
                  only, see 03_core_dimensions.sql), RefPeopleCostHistory's
                  OwnerId='HUB' rows (the CoE team pool — the real source of
                  hub people cost), RefExceptionType.
     Spokes own:  their RefProposition rows, their RefProcess rows (SMV +
                  grade automated against), their RefQueueMap rows, their
                  RefResource rows (which VDIs the spoke pays for, plus each
                  VDI's renewal/coverage-window fields), and RefPeopleCostHistory's
                  OwnerId=<spokeId> rows (informational only — never charged
                  into estate economics).
   ===================================================================== */
USE BPAnalytics;
GO

/* ---- Spokes: the CoE operating model ---- */
DELETE FROM core.RefQueueMap;
DELETE FROM core.RefProcess;
DELETE FROM core.RefProposition;
DELETE FROM core.RefResource;
DELETE FROM core.RefSpoke;
INSERT INTO core.RefSpoke (SpokeId, SpokeName, ShortName, ColorHexLight, ColorHexDark) VALUES
    (1, 'Insurance, Pensions & Investments', 'IP&I', '#2a78d6', '#3987e5'),
    (2, 'Risk',                              'RSK',  '#d29200', '#c98500'),
    (3, 'Commercial',                        'COM',  '#c2416b', '#d55181'),
    (4, 'Consumer Lending',                  'CLD',  '#006b00', '#008300');
GO

/* ---- Grade rate card: date-effective £/h per grade (hub-owned).
        Benefit is valued at the rate in force on each item's outcome date.
        The 2026-04-01 rows model a pay review: history keeps the old rate. ---- */
DELETE FROM core.RefGradeRate;
INSERT INTO core.RefGradeRate (GradeCode, GradeName, EffectiveFrom, HourlyCostGBP) VALUES
    ('OPS3', 'Ops Grade 3',          '2023-01-01', 28.00),
    ('OPS3', 'Ops Grade 3',          '2026-04-01', 29.00),
    ('SOPS', 'Senior Ops',           '2023-01-01', 32.00),
    ('SOPS', 'Senior Ops',           '2026-04-01', 33.20),
    ('PSPC', 'Pensions Specialist',  '2023-01-01', 38.00),
    ('PSPC', 'Pensions Specialist',  '2026-04-01', 39.40),
    ('PANL', 'Pensions Analyst',     '2023-01-01', 30.00),
    ('PANL', 'Pensions Analyst',     '2026-04-01', 31.10),
    ('UWSP', 'Underwriting Support', '2023-01-01', 42.00),
    ('UWSP', 'Underwriting Support', '2026-04-01', 43.50),
    ('IANL', 'Investment Analyst',   '2023-01-01', 36.00),
    ('IANL', 'Investment Analyst',   '2026-04-01', 37.30),
    ('KYCS', 'KYC Specialist',       '2023-01-01', 40.00),
    ('KYCS', 'KYC Specialist',       '2026-04-01', 41.40),
    ('RANL', 'Risk Analyst',         '2023-01-01', 34.00),
    ('RANL', 'Risk Analyst',         '2026-04-01', 35.20),
    ('CUAS', 'Commercial Underwriting Assistant', '2023-01-01', 36.00),
    ('CUAS', 'Commercial Underwriting Assistant', '2026-04-01', 37.30),
    ('FANL', 'Finance Analyst',      '2023-01-01', 32.00),
    ('FANL', 'Finance Analyst',      '2026-04-01', 33.10),
    ('LOPS', 'Lending Ops',          '2023-01-01', 27.00),
    ('LOPS', 'Lending Ops',          '2026-04-01', 28.00);
GO

/* ---- Propositions: the business areas, each owned by a spoke ---- */
INSERT INTO core.RefProposition (PropositionId, PropositionName, SpokeId) VALUES
    (1, 'General Insurance',    1),
    (2, 'Home Insurance',       1),
    (3, 'Pensions',             1),
    (4, 'Life & Protection',    1),
    (5, 'Investments',          1),
    (6, 'Financial Crime',      2),
    (7, 'Commercial Insurance', 3),
    (8, 'Personal Loans',       4);
GO

/* ---- Processes: sit above queues. SMVMinutes + GradeCode are the benefit
        inputs: SMV x the grade's rate in force on the outcome date. ---- */
INSERT INTO core.RefProcess
    (ProcessId, ProcessName, ProcessAcronym, ProcessDescription,
     PropositionId, SMVMinutes, GradeCode, IsActive) VALUES
    (101, 'Insurance New Business', 'INB',  'New insurance policy set-up and underwriting handoff',  1, 18, 'OPS3', 1),
    (102, 'Insurance Renewals',     'IRN',  'Annual policy renewal processing and re-rating',        1, 12, 'OPS3', 1),
    (103, 'Home Claims',            'HCL',  'Home insurance claim validation and settlement set-up', 2, 35, 'SOPS', 1),
    (104, 'Pension Transfers',      'PTR',  'Inbound and outbound pension transfer processing',      3, 55, 'PSPC', 1),
    (105, 'Pension Valuations',     'PVL',  'Scheme and member valuation calculation',               3, 10, 'PANL', 1),
    (106, 'Life Underwriting',      'LUW',  'Life and protection underwriting assessment',           4, 40, 'UWSP', 1),
    (107, 'Investment Rebalancing', 'IRB',  'Portfolio rebalancing against target allocations',      5, 22, 'IANL', 1),
    (108, 'Investment Onboarding',  'ION',  'New investment account onboarding and KYC',             5, 45, 'KYCS', 1),
    (201, 'Sanctions Screening Referrals',     'SSR', 'Review and disposition of sanctions screening hits',       6, 15, 'RANL', 1),
    (202, 'Fraud Case Triage',                 'FCT', 'First-line triage and enrichment of fraud referrals',      6, 30, 'RANL', 1),
    (301, 'Commercial Quote Ingestion',        'CQI', 'Broker-submitted commercial quote capture and validation', 7, 25, 'CUAS', 1),
    (302, 'Broker Commission Reconciliation',  'BCR', 'Monthly broker commission statement reconciliation',       7, 20, 'FANL', 1),
    (401, 'Loan Application Processing',       'LAP', 'Personal loan application decisioning and account set-up', 8, 28, 'LOPS', 1),
    (402, 'Arrears Payment Plans',             'APL', 'Setting up and amending arrears repayment plans',          8, 22, 'LOPS', 1);
GO

/* ---- Queue map: the real BP queue names mapped to a process. Note two
        queues mapping to ONE process (Pension Transfers), with stages, to
        show the many-queues-to-one-process pattern. ---- */
INSERT INTO core.RefQueueMap (QueueName, ProcessId, StageName, StageOrder) VALUES
    ('INSURANCE_NEW_BUS',  101, NULL, NULL),
    ('INSURANCE_RENEWALS', 102, NULL, NULL),
    ('HOME_CLAIMS',        103, NULL, NULL),
    -- one process, two queues acting as stages:
    ('PENSIONS_TRANSFER',  104, 'Initiation', 1),
    ('PENSIONS_TRF_FINAL', 104, 'Completion', 2),
    ('PENSIONS_VALUATION', 105, NULL, NULL),
    ('LIFE_UNDERWRITING',  106, NULL, NULL),
    ('INVEST_REBALANCE',   107, NULL, NULL),
    ('INVEST_ONBOARDING',  108, NULL, NULL),
    ('RISK_SANCTIONS',     201, NULL, NULL),
    ('RISK_FRAUD_TRIAGE',  202, NULL, NULL),
    ('COMM_QUOTE_INGEST',  301, NULL, NULL),
    ('COMM_BROKER_RECON',  302, NULL, NULL),
    ('LEND_APPLICATIONS',  401, NULL, NULL),
    ('LEND_ARREARS_PLANS', 402, NULL, NULL);
GO

/* ---- Robots / VDIs. Each belongs to a SPOKE's infra pool (SpokeId NULL =
        hub-owned, lands in the shared hub pool). CostClass rates are hub-set
        in RefVDICostHistory unless AnnualCostGBP overrides them (PROD-07).
        Includes a retired VDI (PROD-03, LicenseExpiryDate = its retirement
        date, Status = 'retired') and a later-added one (PROD-07) so infra
        cost reflects the estate over time. RenewalDate anchors each VDI's
        365-day coverage cycle (see RefResource's comment in
        03_core_dimensions.sql and report.fn_VdiDailyCost in
        08_report_views.sql). ---- */
INSERT INTO core.RefResource
    (ResourceName, BotName, BotAcronym, VDIName, CostClass, SpokeId,
     ActiveFrom, ActiveTo, Notes, IsActive,
     RenewalDate, AnnualCostGBP, LicenseExpiryDate, Status) VALUES
    ('VDI-RPA-PROD-01', 'BOT-INS-01',  'BI01', 'VDI-RPA-PROD-01', 'prod', 1,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-02', 'BOT-INS-02',  'BI02', 'VDI-RPA-PROD-02', 'prod', 1,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-03', 'BOT-INS-03',  'BI03', 'VDI-RPA-PROD-03', 'prod', 1,    '2023-01-01', '2025-03-31', 'Retired Mar 2025',       0, '2023-01-01', NULL,  '2025-03-31', 'retired'),
    ('VDI-RPA-PROD-04', 'BOT-PEN-01',  'BP01', 'VDI-RPA-PROD-04', 'prod', 1,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-05', 'BOT-PEN-02',  'BP02', 'VDI-RPA-PROD-05', 'prod', 1,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-06', 'BOT-INV-01',  'BV01', 'VDI-RPA-PROD-06', 'prod', 1,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-07', 'BOT-INV-02',  'BV02', 'VDI-RPA-PROD-07', 'prod', 1,    '2025-06-01', NULL,         'Added Jun 2025; annualCostGBP override demonstrates a deliberately-pricier negotiated rate vs the ''prod'' class rate (9600 from 2025-07-01)', 1, '2025-06-01', 10200, NULL,         'active'),
    ('VDI-RPA-PROD-08', 'BOT-RSK-01',  'BR01', 'VDI-RPA-PROD-08', 'prod', 2,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-09', 'BOT-COM-01',  'BC01', 'VDI-RPA-PROD-09', 'prod', 3,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-10', 'BOT-LND-01',  'BL01', 'VDI-RPA-PROD-10', 'prod', 4,    '2023-01-01', NULL,         NULL,                     1, '2023-01-01', NULL,  NULL,         'active'),
    ('VDI-RPA-PROD-11', 'BOT-LND-02',  'BL02', 'VDI-RPA-PROD-11', 'prod', 4,    '2025-09-01', NULL,         'Added Sep 2025',         1, '2025-09-01', NULL,  NULL,         'active'),
    ('VDI-RPA-TEST-01', 'BOT-TEST-01', 'BT01', 'VDI-RPA-TEST-01', 'test', NULL, '2023-01-01', NULL,         'Hub-owned test machine', 1, '2023-01-01', NULL,  NULL,         'active');
GO

/* ---- Per-VDI annual cost by class, date-effective (hub-set, universal).
        Prod and test rates, with an example uplift from mid-2025. ---- */
DELETE FROM core.RefVDICostHistory;
INSERT INTO core.RefVDICostHistory (CostClass, EffectiveFrom, AnnualCostPerVDIGBP) VALUES
    ('prod', '2023-01-01', 9000.00),
    ('prod', '2025-07-01', 9600.00),
    ('test', '2023-01-01', 6000.00),
    ('test', '2025-07-01', 6400.00);
GO

/* ---- Working assumptions (+ TeamAnnualCostGBP, schema parity only — see
        03_core_dimensions.sql and RefPeopleCostHistory below, which is the
        real source of hub team cost). ---- */
DELETE FROM core.RefEstateCostHistory;
INSERT INTO core.RefEstateCostHistory
    (EffectiveFrom, TeamAnnualCostGBP,
     WorkingDaysPerYear, ProductiveHoursPerDay, Note) VALUES
    ('2023-01-01', 780000.00, 252, 7.5, 'Initial baseline. NOTE: TeamAnnualCostGBP is retained for schema parity but is NOT read for cost calculation any more — see RefPeopleCostHistory (OwnerId=''HUB'').'),
    ('2025-04-01', 860000.00, 252, 7.5, 'Headcount growth. NOTE: TeamAnnualCostGBP is retained for schema parity but is NOT read for cost calculation any more — see RefPeopleCostHistory (OwnerId=''HUB'').');
GO

/* ---- People cost history: date-effective headcount + annual run-rate per
        owner. OwnerId='HUB' is the SOLE source of truth for the hub team's
        people cost fed into report.vw_EstateRateByDate — it mirrors
        RefEstateCostHistory's two figures above exactly (14 people /
        £780,000 from 2023-01-01, then 16 / £860,000 from 2025-04-01), since
        both describe the same headcount growth event. OwnerId=<spokeId> rows
        are informational only (a spoke's own reporting) and are never wired
        into any cost view — spokes are charged for VDI infra only. KEEP IN
        STEP with data/reference/reference.json's peopleCostHistory[]. ---- */
DELETE FROM core.RefPeopleCostHistory;
INSERT INTO core.RefPeopleCostHistory (OwnerId, Headcount, AnnualCostGBP, EffectiveFrom, Note) VALUES
    ('HUB', 14, 780000.00, '2023-01-01', 'Hub CoE team run-rate — SOLE source of truth for hub people cost in the cost engine. Mirrors estateCostHistory''s 2023-01-01 figure exactly.'),
    ('HUB', 16, 860000.00, '2025-04-01', 'Headcount growth. Mirrors estateCostHistory''s 2025-04-01 figure exactly.'),
    ('1',   4,  220000.00, '2023-01-01', 'Informational only — spoke people cost is not charged into estate economics (only spoke INFRA cost is).'),
    ('2',   2,  112000.00, '2023-01-01', 'Informational only — spoke people cost is not charged into estate economics (only spoke INFRA cost is).'),
    ('3',   2,  106000.00, '2023-01-01', 'Informational only — spoke people cost is not charged into estate economics (only spoke INFRA cost is).'),
    ('4',   3,  152000.00, '2023-01-01', 'Informational only — spoke people cost is not charged into estate economics (only spoke INFRA cost is).');
GO

/* ---- Exception classification: FALLBACK patterns only. The preferred
        approach is to prefix exception detail at source with "Business
        Exception" or "System Exception", which the merge reads first and
        deterministically. These patterns cover only exceptions not yet
        prefixed, and should shrink toward zero as processes adopt the
        prefix convention. Order doesn't matter; Priority and pattern
        length decide ties. ---- */
DELETE FROM core.RefExceptionType;
INSERT INTO core.RefExceptionType (MatchPattern, ExceptionType, Priority) VALUES
    ('%timeout%',                  'System',   100),
    ('%not found on screen%',      'System',   100),
    ('%failed to launch%',         'System',   100),
    ('%login failed%',             'System',   100),
    ('%dialog%',                   'System',   100),
    ('%citrix%',                   'System',   100),
    ('%connection%',               'System',   100),
    ('%session disconnected%',     'System',   100),
    -- business patterns (illustrative; unmatched exceptions default to
    -- Business in the merge, so System is the main type to capture here)
    ('%not found in core system%', 'Business', 100),
    ('%invalid for processing%',   'Business', 100),
    ('%documentation%',            'Business', 100),
    ('%outside tolerance%',        'Business', 100),
    ('%duplicate%',                'Business', 100),
    ('%manual referral%',          'Business', 100),
    ('%incomplete%',               'Business', 100);
GO
