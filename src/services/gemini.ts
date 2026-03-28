import type { MealPlanItem, MealType, Recipe, UserProfile } from '../types';

const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function generateWeeklyPlan(
  filters: string[],
  budget: number,
  adults: number,
  children: number,
  profiles: UserProfile[]
): Promise<MealPlanItem[]> {
  const response = await fetch(`${apiBaseUrl}/api/generate-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters,
      budget,
      adults,
      children,
      profiles,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Failed to generate weekly plan');
  }

  return result.plan;
}

export async function regenerateSingleMeal(
  _day: number,
  _mealType: MealType,
  _filters: string[],
  _budget: number,
  _adults: number,
  _children: number,
  _profiles: UserProfile[]
): Promise<Recipe> {
  throw new Error('Single meal regeneration not set up yet');
}

export async function comparePrices(_items: any[], budget: number) {
  return {
    cheapest: 'Tesco',
    comparisons: [
      { name: 'Tesco', totalCost: budget - 5 },
      { name: 'Asda', totalCost: budget - 2 },
      { name: "Sainsbury's", totalCost: budget + 3 },
    ],
    swaps: [],
    budget,
  };
}