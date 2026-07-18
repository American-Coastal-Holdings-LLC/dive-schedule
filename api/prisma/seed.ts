import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { addDaysCivil, todayCivil } from '../src/domain/dates';

// Idempotent seed (wipe + reseed) for BOTH installations. Run: npm run seed.
// inst_demo (tenant_demo, America/Los_Angeles) — the rich demo tenant.
// inst_other (tenant_two, America/New_York) — olga's isolated tenant.

const prisma = new PrismaClient();

const TZ_DEMO = 'America/Los_Angeles';
const TZ_OTHER = 'America/New_York';

const USR = {
  dana: 'usr_dana',
  sam: 'usr_sam',
  riley: 'usr_riley',
  casey: 'usr_casey',
  olga: 'usr_olga',
};
const NAME = {
  [USR.dana]: 'Dana Reyes',
  [USR.sam]: 'Sam Okafor',
  [USR.riley]: 'Riley Chen',
  [USR.casey]: 'Casey Marsh',
  [USR.olga]: 'Olga Petrov',
};

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

async function wipe(): Promise<void> {
  await prisma.serviceRecord.deleteMany();
  await prisma.job.deleteMany();
  await prisma.checklistQuestion.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.crewProfile.deleteMany();
  await prisma.installationSettings.deleteMany();
  await prisma.installation.deleteMany();
}

async function seedDemo(): Promise<void> {
  const inst = 'inst_demo';
  const today = todayCivil(TZ_DEMO);

  await prisma.installation.create({
    data: { id: inst, tenantId: 'tenant_demo', status: 'active' },
  });
  await prisma.installationSettings.create({
    data: {
      installationId: inst,
      payRate: 0.5,
      reportCcEmail: 'ops@bluehorizondive.example',
      estimateRatePerFoot: 9,
    },
  });

  await prisma.crewProfile.createMany({
    data: [
      {
        installationId: inst,
        userId: USR.dana,
        certifications: 'PADI Course Director; Commercial Diver',
        bio: 'Owner-operator. 15 years of hull service in the harbor.',
        joined: '2015-04-12',
      },
      {
        installationId: inst,
        userId: USR.sam,
        certifications: 'PADI Divemaster; Hull Inspection cert',
        bio: 'Crew lead. Runs the Tuesday and Thursday routes.',
        joined: '2019-06-01',
      },
      {
        installationId: inst,
        userId: USR.riley,
        certifications: 'PADI Rescue Diver',
        bio: 'Diver. Fast on bottom-cleaning; strong in low-viz.',
        joined: '2022-03-15',
      },
      {
        installationId: inst,
        userId: USR.casey,
        certifications: '',
        bio: 'Front desk and scheduling.',
        joined: '2021-09-20',
      },
    ],
  });

  const questions = [
    'Hull inspected for marine growth',
    'Anodes / zincs checked and rated',
    'Propeller & running gear cleaned',
    'Through-hull fittings and intakes clear',
    'Completion photos captured',
  ];
  await prisma.checklistQuestion.createMany({
    data: questions.map((text, i) => ({ installationId: inst, text, ord: i })),
  });
  const jobAnswers = questions.map((q, i) => ({ id: `q${i}`, q, a: 'Yes' }));
  const recordAnswers = questions.map((q) => ({ q, a: 'Yes' }));

  // Open jobs across all four rotations. Riley is assigned to A, B, D (3 open).
  await prisma.job.createMany({
    data: [
      {
        installationId: inst,
        site: 'Marina del Rey',
        boat: 'Sea Breeze',
        ownerName: 'Marcus Bell',
        customerEmail: 'marcus.bell@example.com',
        footage: 32,
        price: 180,
        rotation: 'weekly',
        dueDate: addDaysCivil(today, 2),
        status: 'open',
        notes: 'Gate code 4417. Slip C-12.',
        assignedUserIds: [USR.riley, USR.sam],
      },
      {
        installationId: inst,
        site: 'Long Beach Marina',
        boat: 'Blue Marlin',
        ownerName: 'Priya Nair',
        customerEmail: 'priya.nair@example.com',
        footage: 28,
        price: 150,
        rotation: 'biweekly',
        dueDate: addDaysCivil(today, -3), // overdue
        status: 'open',
        assignedUserIds: [USR.riley],
      },
      {
        installationId: inst,
        site: 'Ventura Harbor',
        boat: 'Reef Dancer',
        ownerName: 'Tom Alcaraz',
        customerEmail: 'tom.alcaraz@example.com',
        footage: 40,
        price: 240,
        rotation: 'monthly',
        dueDate: addDaysCivil(today, 18),
        status: 'open',
        assignedUserIds: [USR.sam],
      },
      {
        installationId: inst,
        site: 'Marina del Rey',
        boat: 'Wind Chaser',
        ownerName: 'Elena Ruiz',
        customerEmail: 'elena.ruiz@example.com',
        footage: 36,
        price: 210,
        rotation: 'bimonthly',
        dueDate: addDaysCivil(today, 40),
        status: 'open',
        assignedUserIds: [USR.riley],
      },
    ],
  });

  // Completed job E -> SENT (frozen) record, credited to Sam ~10 days ago.
  const doneE = daysAgo(10);
  const jobE = await prisma.job.create({
    data: {
      installationId: inst,
      site: 'Channel Islands Harbor',
      boat: 'Salty Dog',
      ownerName: 'Greg Vance',
      customerEmail: 'greg.vance@example.com',
      footage: 30,
      price: 170,
      rotation: 'weekly',
      dueDate: addDaysCivil(today, 4),
      status: 'completed',
      assignedUserIds: [USR.sam],
      completedBy: USR.sam,
      completedByName: NAME[USR.sam],
      completedAt: doneE,
      completionNote: 'Heavy growth near the waterline, cleared. Anodes at ~40%.',
      checkAnswers: jobAnswers,
      certified: true,
      certifiedAt: doneE,
    },
  });
  await prisma.serviceRecord.create({
    data: {
      installationId: inst,
      jobId: jobE.id,
      site: jobE.site,
      boat: jobE.boat,
      ownerName: jobE.ownerName,
      customerEmail: jobE.customerEmail,
      diverNames: NAME[USR.sam],
      completedBy: USR.sam,
      completedByName: NAME[USR.sam],
      completedAt: doneE,
      rotation: 'weekly',
      price: 170,
      footage: 30,
      note: 'Heavy growth near the waterline, cleared. Anodes at ~40%.',
      certified: true,
      certifiedAt: doneE,
      answers: recordAnswers,
      sent: true,
      sentAt: daysAgo(9),
      sentTo: 'greg.vance@example.com',
    },
  });

  // Completed job F -> ACTIVE (unsent) record, credited to Riley THIS week
  // (completedAt = now) so his pay for the current week is nonzero.
  const jobF = await prisma.job.create({
    data: {
      installationId: inst,
      site: 'Marina del Rey',
      boat: 'Coral Queen',
      ownerName: 'Nina Frost',
      customerEmail: 'nina.frost@example.com',
      footage: 34,
      price: 200,
      rotation: 'weekly',
      dueDate: addDaysCivil(today, 5),
      status: 'completed',
      assignedUserIds: [USR.riley],
      completedBy: USR.riley,
      completedByName: NAME[USR.riley],
      completedAt: now,
      completionNote: 'Standard clean. Prop polished.',
      checkAnswers: jobAnswers,
      certified: true,
      certifiedAt: now,
    },
  });
  await prisma.serviceRecord.create({
    data: {
      installationId: inst,
      jobId: jobF.id,
      site: jobF.site,
      boat: jobF.boat,
      ownerName: jobF.ownerName,
      customerEmail: jobF.customerEmail,
      diverNames: NAME[USR.riley],
      completedBy: USR.riley,
      completedByName: NAME[USR.riley],
      completedAt: now,
      rotation: 'weekly',
      price: 200,
      footage: 34,
      note: 'Standard clean. Prop polished.',
      certified: true,
      certifiedAt: now,
      answers: recordAnswers,
      sent: false,
    },
  });

  // Inventory: some sellable (salePrice > 0), one low-stock (Prop scrub pad).
  await prisma.inventoryItem.createMany({
    data: [
      { installationId: inst, name: 'Hull scraper', type: 'item', quantity: 12, unitCost: 8, salePrice: 0, sku: 'HS-01', lowStockAt: 3, notes: '' },
      { installationId: inst, name: 'Replacement zinc anode', type: 'part', quantity: 40, unitCost: 6, salePrice: 15, sku: 'ZN-25', lowStockAt: 10, notes: '' },
      { installationId: inst, name: 'Prop scrub pad', type: 'item', quantity: 5, unitCost: 2, salePrice: 6, sku: 'PS-09', lowStockAt: 8, notes: 'Reorder soon' },
      { installationId: inst, name: 'Dive gloves (M)', type: 'tool', quantity: 20, unitCost: 12, salePrice: 0, sku: 'DG-M', lowStockAt: 4, notes: '' },
      { installationId: inst, name: 'Sacrificial anode kit', type: 'part', quantity: 18, unitCost: 22, salePrice: 45, sku: 'AK-KIT', lowStockAt: 5, notes: '' },
      { installationId: inst, name: 'Underwater flashlight', type: 'tool', quantity: 7, unitCost: 30, salePrice: 55, sku: 'UF-3', lowStockAt: 3, notes: '' },
      { installationId: inst, name: 'Barnacle brush', type: 'item', quantity: 25, unitCost: 4, salePrice: 10, sku: 'BB-07', lowStockAt: 6, notes: '' },
      { installationId: inst, name: 'Regulator O-ring set', type: 'part', quantity: 60, unitCost: 1, salePrice: 4, sku: 'OR-SET', lowStockAt: 15, notes: '' },
    ],
  });

  // Ledger spread over ~6 months (mix of in/out) for the trend + period cards.
  await prisma.ledgerEntry.createMany({
    data: [
      { installationId: inst, kind: 'in', amount: 90, description: 'Retail: zinc anodes', category: 'POS · Cash', date: addDaysCivil(today, 0) },
      { installationId: inst, kind: 'out', amount: 140, description: 'Boat fuel', category: 'Fuel', date: addDaysCivil(today, -6) },
      { installationId: inst, kind: 'in', amount: 60, description: 'Retail: brush + pads', category: 'POS · Cash', date: addDaysCivil(today, -20) },
      { installationId: inst, kind: 'out', amount: 320, description: 'Compressor service', category: 'Maintenance', date: addDaysCivil(today, -34) },
      { installationId: inst, kind: 'in', amount: 120, description: 'Retail: flashlight', category: 'POS · Cash', date: addDaysCivil(today, -52) },
      { installationId: inst, kind: 'out', amount: 240, description: 'New wetsuit', category: 'Equipment', date: addDaysCivil(today, -71) },
      { installationId: inst, kind: 'out', amount: 180, description: 'Dock fees', category: 'Overhead', date: addDaysCivil(today, -96) },
      { installationId: inst, kind: 'in', amount: 75, description: 'Retail: gloves', category: 'POS · Cash', date: addDaysCivil(today, -128) },
      { installationId: inst, kind: 'out', amount: 300, description: 'Air tank hydro test', category: 'Maintenance', date: addDaysCivil(today, -150) },
    ],
  });
}

async function seedOther(): Promise<void> {
  const inst = 'inst_other';
  const today = todayCivil(TZ_OTHER);

  await prisma.installation.create({
    data: { id: inst, tenantId: 'tenant_two', status: 'active' },
  });
  await prisma.installationSettings.create({
    data: {
      installationId: inst,
      payRate: 0.4,
      reportCcEmail: 'hello@reefrunners.example',
      estimateRatePerFoot: 11,
    },
  });
  await prisma.crewProfile.create({
    data: {
      installationId: inst,
      userId: USR.olga,
      certifications: 'NAUI Instructor',
      bio: 'Owner, Reef Runners Marine.',
      joined: '2018-01-10',
    },
  });
  await prisma.checklistQuestion.createMany({
    data: [
      { installationId: inst, text: 'Hull cleaned', ord: 0 },
      { installationId: inst, text: 'Zincs checked', ord: 1 },
    ],
  });
  await prisma.job.createMany({
    data: [
      {
        installationId: inst,
        site: 'Sunset Harbor',
        boat: 'Second Wind',
        ownerName: 'R. Delgado',
        customerEmail: 'delgado@example.com',
        footage: 30,
        price: 160,
        rotation: 'weekly',
        dueDate: addDaysCivil(today, 3),
        status: 'open',
        assignedUserIds: [USR.olga],
      },
      {
        installationId: inst,
        site: 'Sunset Harbor',
        boat: 'Kingfisher',
        ownerName: 'B. Osei',
        customerEmail: 'osei@example.com',
        footage: 45,
        price: 260,
        rotation: 'monthly',
        dueDate: addDaysCivil(today, 25),
        status: 'open',
        assignedUserIds: [USR.olga],
      },
    ],
  });
  await prisma.inventoryItem.createMany({
    data: [
      { installationId: inst, name: 'Hull brush', type: 'item', quantity: 10, unitCost: 5, salePrice: 12, sku: 'RR-BB', lowStockAt: 3, notes: '' },
      { installationId: inst, name: 'Zinc anode', type: 'part', quantity: 20, unitCost: 6, salePrice: 14, sku: 'RR-ZN', lowStockAt: 5, notes: '' },
    ],
  });
  await prisma.ledgerEntry.create({
    data: {
      installationId: inst,
      kind: 'in',
      amount: 120,
      description: 'Retail sale',
      category: 'POS · Cash',
      date: addDaysCivil(today, 0),
    },
  });
}

async function main(): Promise<void> {
  await wipe();
  await seedDemo();
  await seedOther();

  const [jobs, records, inv, ledger] = await Promise.all([
    prisma.job.count(),
    prisma.serviceRecord.count(),
    prisma.inventoryItem.count(),
    prisma.ledgerEntry.count(),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `Seed complete. inst_demo + inst_other: ${jobs} jobs, ${records} records, ${inv} inventory items, ${ledger} ledger entries.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
