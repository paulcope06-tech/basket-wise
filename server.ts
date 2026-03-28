import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

app.post('/api/generate-plan', async (req, res) => {
  console.log('1. Route hit');

  try {
    const { budget, adults, children, filters, profiles } = req.body;
    console.log('2. Body received');

    const prompt = `
Create a 7-day meal plan for:
- Budget: £${budget}
- Adults: ${adults}
- Children: ${children}
- Filters: ${JSON.stringify(filters)}
- Profiles: ${JSON.stringify(profiles)}

Return ONLY valid JSON in this format:
[
  {
    "day": 0,
    "mealType": "breakfast",
    "recipe": {
      "title": "Example meal",
      "tags": ["budget"],
      "prepTime": 10,
      "cookTime": 20,
      "costPerServing": 2.5,
      "ingredients": [
        { "name": "Eggs", "amount": "2", "unit": "pcs", "category": "Dairy" }
      ],
      "instructions": ["Step 1", "Step 2"],
      "nutrition": {
        "calories": 400,
        "protein": 20,
        "carbohydrates": 30,
        "fat": 15
      }
    }
  }
]
Generate 21 items total: breakfast, lunch, dinner for 7 days.
`;

    console.log('3. Sending to OpenAI');

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: prompt,
    });

    console.log('4. OpenAI responded');

    const text = response.output_text;
    console.log('5. Got text from OpenAI');

    const parsed = JSON.parse(text);
    console.log('6. Parsed JSON');

    const { data: savedPlan, error: savePlanError } = await supabase
      .from('meal_plans')
      .insert([
        {
          user_id: null,
          plan: parsed,
        },
      ])
      .select()
      .single();

    if (savePlanError) {
      console.error('7. meal_plans save error:', savePlanError);
      return res.status(500).json({ error: savePlanError.message });
    }

    const mealItems = parsed.map((item: any) => ({
      plan_id: savedPlan.id,
      day: item.day,
      meal_type: item.mealType,
      recipe_title: item.recipe.title,
      recipe: item.recipe,
    }));

    const { data: savedItems, error: saveItemsError } = await supabase
      .from('meal_plan_items')
      .insert(mealItems)
      .select();

    if (saveItemsError) {
      console.error('8. meal_plan_items save error:', saveItemsError);
      return res.status(500).json({ error: saveItemsError.message });
    }

    console.log('9. Saved meal items to Supabase');

    return res.json({
      plan: parsed,
      savedPlan,
      savedItems,
    });
  } catch (error: any) {
    console.error('SERVER ERROR:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to generate meal plan',
    });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});