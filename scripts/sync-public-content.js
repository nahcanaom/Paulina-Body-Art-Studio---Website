/**
 * One-off content synchronisation for the admin "Edit Website" tables.
 *
 * The public pages were authored first. This script copies their wording and
 * image metadata into Supabase so the dashboard mirrors what visitors already
 * see, then seeds the artist profile that was previously static markup.
 *
 * Run with:  node scripts/sync-public-content.js
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_URL = 'https://celusvfynfnszmhjgqwj.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g';

const configuredUrl = String(process.env.SUPABASE_URL || '').trim();
const configuredKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// .env ships with placeholders for this project. Fall back to the public
// project URL and publishable key used by the browser client; the Edit Website
// tables allow anon writes under their current RLS policies.
const url = configuredUrl && !configuredUrl.includes('YOUR_PROJECT_REF')
  ? configuredUrl
  : DEFAULT_URL;
const key = configuredKey && !/^YOUR_/.test(configuredKey)
  ? configuredKey
  : DEFAULT_ANON_KEY;

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const bookingPatch = {
  intro: "Tell us a little about yourself and the service you'd like to book.",
  depositNote: 'Deductible from your final bill.',
  reschedulePolicy:
    'Rescheduling requests must be sent at least 48 hours before your appointment time. You may reschedule once without forfeiting your booking deposit.',
  cancellationPolicy:
    'If you cancel your appointment, booking deposits are strictly non-refundable. Cancellations made within 24 hours will require a new deposit to rebook.',
  arrivalInstructions:
    'Please arrive 10 minutes early. Clients arriving 15 minutes late will be required to pay a \u20B1500 late fee; arriving 20 minutes or more will be treated as a no-show.'
};

const aftercareAnswers = {
  'What is jewelry downsizing?':
    'Fresh piercings usually require longer jewelry to allow room for swelling. Once the swelling decreases, the extra length may cause unnecessary movement, irritation, or snagging. Downsizing involves replacing the longer jewelry with a shorter, properly fitted piece.',
  'When Should You Downsize?':
    'Most piercings may be ready for downsizing after 4\u20136 weeks, while some oral piercings may need it as early as 2\u20133 weeks. However, the right time depends on the piercing location and how quickly the swelling decreases. Always consult your piercer before changing jewelry.',
  'Signs You May Need Downsizing':
    'Your jewelry may need downsizing if the bar appears too long, moves excessively, or frequently catches on hair, clothing, or towels. Repeated irritation or discomfort may also indicate that the jewelry needs to be checked by a professional piercer.',
  'Why Is It Important?':
    'Properly fitted jewelry helps reduce snagging, irritation bumps, and unnecessary movement during healing. Leaving jewelry too long may contribute to delayed healing, migration, or other complications.',
  'Who Should Perform Downsizing?':
    'Jewelry downsizing should be performed by a professional piercer. They can assess the healing progress, select the appropriate jewelry length, and safely replace it without causing unnecessary irritation or injury.'
};

// Image metadata is matched against the stored file name so the existing
// uploaded artwork is preserved rather than replaced.
const imageMetadata = [
  {
    section: 'home-studio',
    match: 'stud-1',
    title: 'Lounge & Reception Area',
    alt: 'Studio Reception Area',
    description:
      'Relax in our atmospheric, sterile, and modern reception area while discussing your tattoo and piercing concepts with our friendly staff.',
    displayOrder: 0
  },
  {
    section: 'home-studio',
    match: 'stud-2',
    title: 'Main Tattoo Station',
    alt: 'Main Tattoo Station',
    description:
      'Equipped with top-tier ergonomic hydraulic chairs, shadowless LED surgical lighting, and fully sanitized workstation surfaces for maximum comfort and safety.',
    displayOrder: 1
  },
  {
    section: 'home-studio',
    match: 'stud-3',
    title: 'Private Piercing Suite',
    alt: 'Private Piercing Suite',
    description:
      'A clean, private room dedicated entirely to body piercings, jewelry fitting, and detailed aftercare instructions in total privacy.',
    displayOrder: 2
  },
  {
    section: 'home-services',
    match: 'service1',
    title: 'Precision Body Piercing',
    subtitle: 'cross',
    alt: 'Ear Piercing Detail',
    description:
      'Professional ear, facial, and body piercings using implant-grade titanium, gold, and nickel-free jewelry with sterile single-use equipment.',
    displayOrder: 0
  },
  {
    section: 'home-services',
    match: 'service2',
    title: 'Fine-Line & Ornamental Tattoos',
    subtitle: 'curated',
    alt: 'Fine Line Tattoo',
    description:
      'Detailed fine-line work, intricate geometric patterns, delicate lace work, and custom arm/leg sleeves designed tailored to your body contours.',
    displayOrder: 1
  },
  {
    section: 'home-services',
    match: 'service3',
    title: 'Torso & Delicate Body Art',
    subtitle: 'navel',
    alt: 'Body Ink Placement',
    description:
      'Subtle placement art, sternum tattoos, micro-realism, and custom delicate ink executed with minimal pain and fast healing protocols.',
    displayOrder: 2
  },
  {
    section: 'artist-favorites',
    match: 'fave1',
    title: 'Vampire Snake Bites',
    alt: 'Vampire Piercing',
    description: 'Custom implant-grade titanium fangs fitting styled for high-impact lip symmetry.',
    displayOrder: 0
  },
  {
    section: 'artist-favorites',
    match: 'fave2',
    title: 'Curated Ear Stack',
    alt: 'Ear Curation Piercing',
    description: 'Triple lobe, conch, and helix arrangement utilizing 14k solid gold ends and crystal studs.',
    displayOrder: 1
  },
  {
    section: 'artist-favorites',
    match: 'fave3',
    title: 'Dainty Navel Floating Gem',
    alt: 'Navel Piercing',
    description: 'Precision floating navel barbell with genuine CZ teardrop gem placement.',
    displayOrder: 2
  },
  {
    section: 'pricelist',
    match: 'pricelist',
    title: 'Piercing Price List',
    alt: 'Piercing service prices',
    description: 'Piercing service prices, jewelry options, and studio policies.',
    displayOrder: 0
  },
  {
    section: 'booking-qr',
    match: 'qr',
    title: 'GCash QR code',
    alt: 'GCash QR code',
    description: 'Scan to send your reservation deposit via GCash.',
    displayOrder: 0
  },
  {
    section: 'booking-side',
    match: 'stud-1',
    title: 'Studio Art Wall',
    alt: 'Studio Art Wall',
    description: 'Studio artwork beside the booking details form.',
    displayOrder: 0
  },
  {
    section: 'booking-payment-side',
    match: 'stud-1',
    title: 'Studio Art Wall',
    alt: 'Studio Art Wall',
    description: 'Studio artwork behind the payment QR card.',
    displayOrder: 0
  },
  {
    section: 'aftercare-hero-tattoo',
    match: 'hero-picture',
    title: 'Tattoo Aftercare',
    alt: 'A PAULINA Studio tattoo artist working carefully with pink protective gloves',
    description: 'The tattoo care hero artwork.',
    displayOrder: 0
  },
  {
    section: 'aftercare-hero-piercing',
    match: 'piercing-artist',
    title: 'Piercing Aftercare',
    alt: 'A PAULINA Studio piercer carefully working with a client',
    description: 'The piercing care hero artwork.',
    displayOrder: 0
  },
  {
    section: 'aftercare-guide',
    match: 'piercing-guide-square',
    title: 'Piercing Healing Guide',
    alt: 'Original PAULINA piercing aftercare guide in a square format',
    description: 'The square piercing healing guide.',
    displayOrder: 0
  },
  {
    section: 'aftercare-neilmed',
    match: 'neilmed',
    title: 'NeilMed Piercing Aftercare',
    alt: 'NeilMed piercing aftercare products with red lace ribbons',
    description: 'Sterile saline aftercare products stocked by the studio.',
    displayOrder: 0
  },
  {
    section: 'aftercare-downsizing',
    match: 'downsizing',
    title: 'Why Jewelry Downsizing Matters',
    alt: 'Original piercing jewelry downsizing illustration and guidance in a square format',
    description: 'The square jewellery downsizing illustration.',
    displayOrder: 0
  }
];

const artistProfile = {
  name: 'Paulina Vampire',
  role: 'Founder & Master Piercer',
  bio:
    'Paulina Vampire is the visionary artist, master piercer, and founding owner behind Paulina Body Art Studio, a premier destination for high-end body modification and custom tattoo artistry. Blending technical precision with raw creative expression, she has built a studio known for its exceptional hygiene standards and welcoming atmosphere. Specializing in precision body piercing, curated ear styling, and fine-line tattoos, she views the human body as the ultimate canvas and is dedicated to transforming each client\u2019s unique vision into a safe, beautiful, and lasting statement.',
  specialties: ['Precision Body Piercing', 'Curated Ear Styling', 'Fine-Line Tattoos'],
  avatar_url: '../../assets/images/mspau.png',
  instagram_url: 'https://www.instagram.com/paulinabodyart/',
  is_published: true,
  display_order: 0
};

async function syncBooking() {
  const { data: row, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'booking')
    .maybeSingle();
  if (error) throw error;

  const next = { ...(row?.value || {}), ...bookingPatch };
  const { error: upsertError } = await supabase
    .from('site_settings')
    .upsert({ key: 'booking', value: next, updated_at: new Date().toISOString() });
  if (upsertError) throw upsertError;
  console.log('Updated booking settings.');
}

async function syncAftercareFaqs() {
  const { data, error } = await supabase
    .from('faqs')
    .select('id,question,answer')
    .eq('category', 'Aftercare');
  if (error) throw error;

  let updated = 0;
  for (const faq of data || []) {
    const expected = aftercareAnswers[faq.question];
    if (!expected || expected === faq.answer) continue;
    const { error: updateError } = await supabase
      .from('faqs')
      .update({ answer: expected, updated_at: new Date().toISOString() })
      .eq('id', faq.id);
    if (updateError) throw updateError;
    updated += 1;
  }
  console.log(`Updated ${updated} aftercare FAQ answer(s).`);
}

async function syncSiteImages() {
  const { data, error } = await supabase
    .from('site_images')
    .select('id,section,image_url,title,subtitle,alt_text,description,display_order');
  if (error) throw error;

  let updated = 0;
  for (const entry of imageMetadata) {
    const row = (data || []).find(
      (item) => item.section === entry.section && String(item.image_url || '').includes(entry.match)
    );
    if (!row) {
      console.warn(`No image found for ${entry.section} (${entry.match}); skipped.`);
      continue;
    }

    const patch = {
      title: entry.title,
      subtitle: entry.subtitle ?? row.subtitle ?? '',
      alt_text: entry.alt,
      description: entry.description ?? '',
      display_order: entry.displayOrder ?? row.display_order ?? 0,
      updated_at: new Date().toISOString()
    };

    const changed = Object.entries(patch).some(([key, value]) => {
      if (key === 'updated_at') return false;
      return String(row[key] ?? '') !== String(value ?? '');
    });
    if (!changed) continue;

    const { error: updateError } = await supabase.from('site_images').update(patch).eq('id', row.id);
    if (updateError) throw updateError;
    updated += 1;
  }
  console.log(`Updated ${updated} site image record(s).`);
}

async function syncArtistProfile() {
  const { data, error } = await supabase
    .from('artist_profiles')
    .select('id,name')
    .eq('name', artistProfile.name)
    .maybeSingle();
  if (error) throw error;

  if (data?.id) {
    const { error: updateError } = await supabase
      .from('artist_profiles')
      .update({ ...artistProfile, updated_at: new Date().toISOString() })
      .eq('id', data.id);
    if (updateError) throw updateError;
    console.log('Updated the artist profile.');
    return;
  }

  const { error: insertError } = await supabase.from('artist_profiles').insert(artistProfile);
  if (insertError) throw insertError;
  console.log('Seeded the artist profile.');
}

/*
 * Favorite Works are shown inside a specific artist's block, so any seeded or
 * legacy row still missing an artist is linked to the studio's first artist.
 * Reassign works from Edit Website > Artists > Favorite Works afterwards.
 */
async function syncFavoriteWorkArtists() {
  const { data: artist, error } = await supabase
    .from('artist_profiles')
    .select('id')
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!artist?.id) return;

  const { data, error: listError } = await supabase
    .from('site_images')
    .select('id')
    .eq('section', 'artist-favorites')
    .is('artist_id', null);
  if (listError) throw listError;
  if (!data?.length) return;

  const { error: updateError } = await supabase
    .from('site_images')
    .update({ artist_id: artist.id, updated_at: new Date().toISOString() })
    .eq('section', 'artist-favorites')
    .is('artist_id', null);
  if (updateError) throw updateError;

  console.log(`Linked ${data.length} Favorite Work(s) to the first artist.`);
}

try {
  await syncBooking();
  await syncAftercareFaqs();
  await syncSiteImages();
  await syncArtistProfile();
  await syncFavoriteWorkArtists();
  console.log('Public content sync complete.');
} catch (error) {
  console.error('Sync failed:', error.message || error);
  process.exitCode = 1;
}
