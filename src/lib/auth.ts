import { supabase } from "./supabaseClient";

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "http://localhost:3000",
    },
  });

  if (error) throw error;
  return data;
}

