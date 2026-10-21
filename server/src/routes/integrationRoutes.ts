import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';
import { getSupabaseAdmin } from '../config/supabase.js';

export const integrationRouter = Router();

/**
 * Middleware ensuring requests come from an authorized external service (such as LMS)
 */
const requireIntegrationApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-lms-api-key'] || req.headers['x-api-key'];

  if (!apiKey || apiKey !== config.lms.apiKey) {
    res.status(401).json({
      error: 'Unauthorized: Invalid or missing integration API key',
    });
    return;
  }
  next();
};

integrationRouter.use(requireIntegrationApiKey);

/**
 * GET /api/v1/integration/students/:studentNumber/status
 * Used by the Library Management System to check whether a student has any
 * blocking holds or is in good academic standing before borrowing books.
 */
integrationRouter.get('/students/:studentNumber/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentNumber } = req.params;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, student_number, first_name, last_name, email, role, academic_status, department')
      .eq('student_number', studentNumber)
      .single();

    if (error || !profile) {
      res.status(404).json({
        error: `Entity with ID ${studentNumber} not found in Frighton University SIS`,
      });
      return;
    }

    // Retrieve active holds
    const { data: holds } = await supabaseAdmin
      .from('student_holds')
      .select('*')
      .eq('student_id', profile.id)
      .is('resolved_at', null);

    res.json({
      studentNumber: profile.student_number,
      name: `${profile.first_name} ${profile.last_name}`,
      email: profile.email,
      role: profile.role,
      academicStatus: profile.academic_status,
      department: profile.department,
      canBorrow: profile.academic_status === 'active' && (!holds || holds.length === 0),
      activeHolds: holds || [],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integration/holds
 * Allows the Library Management System to automatically place a hold on a student's SIS account
 * (e.g. for overdue materials or unpaid replacement fines).
 */
integrationRouter.post('/holds', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentNumber } = req.body;
    const { reason, amount } = req.body;

    if (!studentNumber || !reason) {
      res.status(400).json({ error: 'studentNumber and reason are required' });
      return;
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Find student
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('student_number', studentNumber)
      .single();

    if (!profile) {
      res.status(404).json({ error: `Student with ID ${studentNumber} not found` });
      return;
    }

    const { data: hold, error } = await supabaseAdmin
      .from('student_holds')
      .insert({
        student_id: profile.id,
        hold_type: 'library_debt',
        reason: amount ? `${reason} (Outstanding Balance: $${amount})` : reason,
        placed_by_system: 'Frighton LMS',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      message: 'Library hold successfully placed in SIS',
      hold,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integration/holds/:holdId/resolve
 * Allows the Library Management System to resolve a hold once items or fines are settled.
 */
integrationRouter.post('/holds/:holdId/resolve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { holdId } = req.params;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: hold, error } = await supabaseAdmin
      .from('student_holds')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', holdId)
      .select()
      .single();

    if (error || !hold) {
      res.status(404).json({ error: 'Hold record not found or could not be updated' });
      return;
    }

    res.json({
      message: 'Library hold successfully resolved in SIS',
      hold,
    });
  } catch (err) {
    next(err);
  }
});
