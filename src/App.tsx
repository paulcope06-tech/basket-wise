import { useState } from 'react';
import { generateWeeklyPlan } from './services/gemini';
import type { MealPlanItem, UserProfile } from './types';

export default function App() {
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const [budget] = useState(60);
  const [adults] = useState(2);
  const [children] = useState(2);
  const [filters] = useState<string[]>(['budget meals', 'kid friendly']);
  const [profiles] = useState<UserProfile[]>([]);

  const handleGeneratePlan = async () => {
    setLoading(true);

    try {
      const newPlan = await generateWeeklyPlan(
        filters,
        budget,
        adults,
        children,
        profiles
      );

      setMealPlan(newPlan);

      setToast({
        message: 'Meal plan generated and saved!',
        type: 'success',
      });
    } catch (error: any) {
      console.error('GENERATE PLAN ERROR:', error);

      setToast({
        message: error?.message || 'Failed to generate or save meal plan',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        padding: '24px',
        fontFamily: 'Arial, sans-serif',
        background: '#eef8f1',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ marginBottom: '20px' }}>Basket Wise</h1>

      <button
        onClick={handleGeneratePlan}
        disabled={loading}
        style={{
          padding: '14px 24px',
          borderRadius: '12px',
          border: 'none',
          background: '#15803d',
          color: 'white',
          fontSize: '16px',
          cursor: 'pointer',
          marginBottom: '20px',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Generating...' : 'Generate Plan'}
      </button>

      {toast && (
        <div
          style={{
            marginBottom: '20px',
            padding: '14px',
            borderRadius: '10px',
            background: toast.type === 'success' ? '#d9f2dd' : '#fde2e2',
            color: toast.type === 'success' ? '#14532d' : '#991b1b',
          }}
        >
          {toast.message}
        </div>
      )}

      {mealPlan.length === 0 ? (
        <p>No meals yet.</p>
      ) : (
        <div>
          <h2>Generated Meals</h2>
          <ul style={{ paddingLeft: '20px' }}>
            {mealPlan.map((item, index) => (
              <li key={index} style={{ marginBottom: '10px' }}>
                <strong>
                  Day {item.day + 1} - {item.mealType}
                </strong>
                : {item.recipe.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}