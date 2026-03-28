import * as React from 'react';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MEAL_TYPES = ['breakfast','lunch','dinner'];

export default function App() {
const [mealPlan, setMealPlan] = useState<any[]>([]);
const [loading, setLoading] = useState(false);

// 🔥 FIXED FUNCTION (no array bug)
const generateSingleRecipe = async (prompt: string) => {
const { data, error } = await supabase.functions.invoke('generate-recipe', {
body: { prompt }
});

```
console.log('FUNCTION DATA:', data);
console.log('FUNCTION ERROR:', error);

if (error) throw error;
return data?.recipe;
```

};

// 🔥 FIXED PLAN GENERATION
const handleGeneratePlan = async () => {
setLoading(true);

```
try {
  const results: any[] = [];

  for (let day = 0; day < DAYS.length; day++) {
    for (const type of MEAL_TYPES) {

      const prompt = `Create a ${type} recipe for ${DAYS[day]}.
```

Return JSON with:
title, ingredients, instructions, prep_time, cook_time`;

```
      const recipe = await generateSingleRecipe(prompt);

      if (recipe) {
        results.push({
          day,
          type,
          recipe
        });
      }
    }
  }

  console.log('FINAL PLAN:', results);
  setMealPlan(results);

} catch (err) {
  console.error(err);
  alert('Failed to generate plan');
} finally {
  setLoading(false);
}
```

};

return (
<div style={{ padding: 20 }}> <h1>Weekly Meal Plan</h1>

```
  <button onClick={handleGeneratePlan} disabled={loading}>
    {loading ? 'Generating...' : 'Generate Plan'}
  </button>

  <div style={{ marginTop: 20 }}>
    {DAYS.map((day, d) => (
      <div key={day} style={{ marginBottom: 20 }}>
        <h2>{day}</h2>

        {MEAL_TYPES.map((type) => {
          const meal = mealPlan.find(m => m.day === d && m.type === type);

          return (
            <div key={type} style={{ marginBottom: 10 }}>
              <strong>{type}:</strong>{' '}
              {meal?.recipe?.title || 'No meal'}
            </div>
          );
        })}
      </div>
    ))}
  </div>
</div>
```

);
}
