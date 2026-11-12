// Supabase configuration and client initialization
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const DEFAULT_SUPABASE_CONFIG = {
  url: "https://celusvfynfnszmhjgqwj.supabase.co",
  anonKey: "sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g", 
  tables: {
    profiles: "profiles",
    publicProfiles: "public_profiles",
    reviews: "reviews",
    bookings: "bookings",
    customRequests: "custom_requests",
    catalogue: "catalogue_items",
    jewelryCatalogue: "jewelry_catalogue",
    gallery: "gallery_items",
    galleryImages: "gallery_images",
    siteSettings: "site_settings",
    siteContent: "site_content",
    siteImages: "site_images",
    artists: "artist_profiles",
    faqs: "faqs",
    notifications: "notifications"
  },
  storage: {
    profilePicturesBucket: "profile_pictures",
    catalogueBucket: "jewelry-catalog",
    galleryBucket: "studio-gallery",
    siteImagesBucket: "site-images",
    customRequestsBucket: "custom-requests"
  },
  redirects: {
    authCallbackPath: "auth-callback.html",
    // Confirmation links land on the home page with the session already set.
    emailConfirmPath: "/html/user-side/home.html",
    passwordResetPath: "reset-password.html"
  },
  options: {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: "paulina-supabase-auth"
    }
  }
};

const runtimeOverrides =
  typeof window !== "undefined" && window.PAULINA_SUPABASE_CONFIG
    ? window.PAULINA_SUPABASE_CONFIG
    : {};

export const supabaseConfig = {
  ...DEFAULT_SUPABASE_CONFIG,
  ...runtimeOverrides,
  tables: {
    ...DEFAULT_SUPABASE_CONFIG.tables,
    ...(runtimeOverrides.tables || {})
  },
  storage: {
    ...DEFAULT_SUPABASE_CONFIG.storage,
    ...(runtimeOverrides.storage || {})
  },
  redirects: {
    ...DEFAULT_SUPABASE_CONFIG.redirects,
    ...(runtimeOverrides.redirects || {})
  },
  options: {
    auth: {
      ...(DEFAULT_SUPABASE_CONFIG.options?.auth || {}),
      ...(runtimeOverrides.options?.auth || {})
    }
  }
};

export function isSupabaseConfigured(config = supabaseConfig) {
  const url = String(config?.url || "").trim();
  const anonKey = String(config?.anonKey || "").trim();
  if (!url || !anonKey) return false;
  if (url.includes("YOUR_PROJECT_REF") || anonKey.includes("YOUR_SUPABASE_ANON_KEY")) return false;
  return /^https?:\/\//i.test(url);
}

export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, supabaseConfig.options);

if (typeof window !== "undefined") {
  window.paulinaSupabase = supabase;
}
