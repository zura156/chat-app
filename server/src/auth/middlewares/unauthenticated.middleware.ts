import { Request, Response, NextFunction } from 'express';

export const unauthenticatedGuard = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = req.cookies.accessToken;
  if (!token) {
    next();
    return;
  } else {
    res
      .status(403)
      .json({
        error: 'You can not access the route when user is authenticated.',
      });
    return;
  }
};
