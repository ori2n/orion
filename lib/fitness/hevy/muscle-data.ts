/**
 * Pure muscle taxonomy + default exercise → muscle map.
 *
 * Free of Supabase imports so the mapping can be validated in isolation
 * (e.g. confirm every exercise name in the real export is covered).
 */

export const MUSCLES = [
  'Chest',
  'Shoulders',
  'Upper Back',
  'Lats',
  'Lower Back',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Traps',
  'Cardio',
] as const;

export type Muscle = (typeof MUSCLES)[number];

export function isMuscle(v: string | null | undefined): v is Muscle {
  return v !== null && v !== undefined && (MUSCLES as readonly string[]).includes(v);
}

/**
 * Sensible seed mapping for every exercise name present in the user's
 * current Hevy export (72 distinct names). Used only to seed; the user
 * can override any entry afterwards.
 */
export const DEFAULT_EXERCISE_MUSCLES: Record<string, Muscle> = {
  'Back Extension (Weighted Hyperextension)': 'Lower Back',
  'Bench Press (Barbell)': 'Chest',
  'Bent Over Row (Barbell)': 'Upper Back',
  'Bicep Curl (Barbell)': 'Biceps',
  'Bicep Curl (Cable)': 'Biceps',
  'Bicep Curl (Dumbbell)': 'Biceps',
  'Bulgarian Split Squat': 'Quads',
  'Bulgarian Split Squat (Dumbbell)': 'Quads',
  'Butterfly (Pec Deck)': 'Chest',
  'Calf Extension (Machine)': 'Calves',
  'Chest Fly (Machine)': 'Chest',
  'Chest Press (Machine)': 'Chest',
  'Chest Supported Incline Row (Dumbbell)': 'Upper Back',
  'Crunch (Machine)': 'Core',
  Cycling: 'Cardio',
  'Dead Hang': 'Lats',
  'Face Pull': 'Shoulders',
  'Hack Squat (Machine)': 'Quads',
  'Hip Abduction (Machine)': 'Glutes',
  'Incline Bench Press (Barbell)': 'Chest',
  'Incline Bench Press (Dumbbell)': 'Chest',
  'Incline Bench Press (Smith Machine)': 'Chest',
  'Incline Chest Press (Machine)': 'Chest',
  'Incline Chest press': 'Chest',
  'Iso-Lateral Chest Press (Machine)': 'Chest',
  'Iso-Lateral Row (Machine)': 'Upper Back',
  'Lat Pulldown (Cable)': 'Lats',
  'Lat Pulldown (Machine)': 'Lats',
  'Lateral Raise (Cable)': 'Shoulders',
  'Lateral Raise (Dumbbell)': 'Shoulders',
  'Lateral Raise (Machine)': 'Shoulders',
  'Leg Extension (Machine)': 'Quads',
  'Leg Press Horizontal (Machine)': 'Quads',
  'Lying Leg Curl (Machine)': 'Hamstrings',
  'Negative Pull Up': 'Lats',
  'Overhead Press (Barbell)': 'Shoulders',
  'Pendulum Squat (Machine)': 'Quads',
  Plank: 'Core',
  'Preacher Curl (Barbell)': 'Biceps',
  'Preacher Curl (Machine)': 'Biceps',
  'Pull Up': 'Lats',
  'Pull Up (Assisted)': 'Lats',
  'Pull Up (Band)': 'Lats',
  'Push Up': 'Chest',
  'Rear Delt Reverse Fly (Dumbbell)': 'Shoulders',
  'Rear Delt Reverse Fly (Machine)': 'Shoulders',
  'Reverse Curl (Cable)': 'Biceps',
  'Reverse Curl (Dumbbell)': 'Biceps',
  'Rope Straight Arm Pulldown': 'Lats',
  'Seated Cable Row - V Grip (Cable)': 'Upper Back',
  'Seated Dip Machine': 'Triceps',
  'Seated Leg Curl (Machine)': 'Hamstrings',
  'Seated Row (Machine)': 'Upper Back',
  'Seated Shoulder Press (Machine)': 'Shoulders',
  'Shoulder Press (Dumbbell)': 'Shoulders',
  'Shoulder Press (Machine Plates)': 'Shoulders',
  'Shrug (Barbell)': 'Traps',
  'Single Arm Triceps Pushdown (Cable)': 'Triceps',
  'Single Leg Extensions': 'Quads',
  'Single Leg Standing Calf Raise (Machine)': 'Calves',
  'Squat (Barbell)': 'Quads',
  'Squat (Smith Machine)': 'Quads',
  'Straight Arm Lat Pulldown (Cable)': 'Lats',
  'Straight Leg Deadlift': 'Hamstrings',
  'Strict Tricep press down': 'Triceps',
  Treadmill: 'Cardio',
  'Tricep Pressdown Holloway': 'Triceps',
  'Tricep Push down Holiday Gym': 'Triceps',
  'Triceps Pressdown': 'Triceps',
  'Triceps Pushdown': 'Triceps',
  'Triceps Rope Pushdown': 'Triceps',
  'decline curls': 'Biceps',
};
