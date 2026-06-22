// supabase/functions/extract-catalog/index.ts
//
// Server-side proxy για την εξαγωγή καταλόγου. Το frontend στέλνει εδώ
// τις εικόνες/κείμενο, αυτό το function καλεί το Claude API με το
// ANTHROPIC_API_KEY (secret, ποτέ ορατό στο browser) και επιστρέφει
// το αποτέλεσμα.
//
// Deploy:
//   supabase functions deploy extract-catalog
// Secret (μία φορά):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Είσαι ειδικός στην ψηφιοποίηση καταλόγων εστιατορίων/καταστημάτων για το efood (Delivery Hero Ελλάδας). Λαμβάνεις ωμό υλικό από ένα νέο κατάστημα — φωτογραφίες χειρόγραφου ή έντυπου μενού, screenshots από ιστοσελίδα, ή απλό κείμενο/email — και το μετατρέπεις σε δομημένο κατάλογο.

ΚΑΝΟΝΕΣ ΕΞΑΓΩΓΗΣ:
1. Εξήγαγε ΜΟΝΟ ό,τι πραγματικά υπάρχει στο υλικό. Μην επινοείς προϊόντα, κατηγορίες, τιμές ή option groups που δεν αναφέρονται ρητά.
2. Αν μια τιμή είναι δυσανάγνωστη, ασαφής, ή λείπει, βάλε price:null, confidence:"low", και εξήγησε γιατί στο notes.
3. Αν ένα όνομα προϊόντος είναι δυσανάγνωστο ή αβέβαιο, κάνε την καλύτερη δυνατή ανάγνωση ΚΑΙ βάλε confidence:"low" με σημείωση για την αβεβαιότητα.
4. Group/option δομές δημιουργούνται μόνο αν υπάρχει πραγματικό ίχνος επιλογών στο υλικό — αν δεν υπάρχει καμία ένδειξη, άφησε option_groups κενό array. type:"required_single" (radio) ή type:"optional_multi" (checkbox).
5. Διατήρησε τα ονόματα στη γλώσσα της πηγής.
6. Αν το ίδιο κατάστημα/προϊόν εμφανίζεται σε πολλαπλές εικόνες/σελίδες, ενοποίησέ το χωρίς διπλότυπα.
7. Απάντησε ΑΠΟΚΛΕΙΣΤΙΚΑ με valid JSON, χωρίς markdown code fences, χωρίς κανένα άλλο κείμενο πριν ή μετά.
8. ΚΡΙΣΙΜΟ — ΜΗΝ ΧΑΝΕΙΣ ΠΛΗΡΟΦΟΡΙΑ ΣΙΩΠΗΛΑ: Αν δεις λίστα επιλογών/υλικών χωρίς ρητές τιμές, ΜΗΝ την αγνοήσεις. Δημιούργησε option_group με price_delta:0 ΜΟΝΟ στο πιο αντιπροσωπευτικό προϊόν, confidence:"low", και σημείωση στο notes. Στα υπόλοιπα σχετικά προϊόντα βάλε σύντομη παραπομπή αντί να επαναλάβεις τη λίστα.
9. Όταν υπάρχουν option_groups με πραγματικές τιμές, διατήρησέ τες ακριβώς όπως δίνονται.

SCHEMA:
{
  "categories": [
    {
      "name": "string",
      "items": [
        {
          "name": "string",
          "price": number | null,
          "description": "string | null",
          "confidence": "high" | "low",
          "notes": "string | null",
          "option_groups": [
            { "title": "string", "type": "required_single" | "optional_multi", "options": [ { "name": "string", "price_delta": number } ] }
          ]
        }
      ]
    }
  ]
}`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images = [], text = "", storeName = "" } = await req.json();

    const content: any[] = [];
    images.forEach((img: { mediaType: string; base64: string }) => {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    });

    let textBlock = "";
    if (storeName) textBlock += `Κατάστημα: ${storeName}\n\n`;
    if (text) textBlock += `ΚΕΙΜΕΝΟ / ΠΕΡΙΕΧΟΜΕΝΟ ΑΡΧΕΙΩΝ:\n${text}\n\n`;
    textBlock += "Εξήγαγε τον πλήρη κατάλογο από το παραπάνω υλικό σύμφωνα με το JSON schema των οδηγιών σου.";
    content.push({ type: "text", text: textBlock });

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY δεν έχει οριστεί στα secrets." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return new Response(JSON.stringify({ error: `Anthropic API error ${anthropicResp.status}: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await anthropicResp.json();
    const textResp = (data.content || []).map((c: any) => c.text || "").join("\n");
    const clean = textResp.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      return new Response(
        JSON.stringify({
          error:
            "Το αποτέλεσμα δεν ήταν έγκυρο JSON (πιθανώς κόπηκε λόγω μεγέθους). Δοκίμασε με λιγότερες εικόνες ανά εξαγωγή.",
          detail: String(parseErr),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
