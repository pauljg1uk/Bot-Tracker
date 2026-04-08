import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import hitsRouter from "./hits";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(hitsRouter);

export default router;
