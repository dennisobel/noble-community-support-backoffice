import { Router } from "express";
import {
  serviceCreateSchema,
  serviceListQuery,
  serviceUpdateSchema,
} from "@shared/schemas/services";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import {
  createService,
  deleteService,
  getServiceDoc,
  listServices,
  toServiceDTO,
  updateService,
} from "./service";

export function servicesRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listServices(parse(serviceListQuery, req.query)));
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(
        await createService(parse(serviceCreateSchema, req.body), ctx(req))
      );
  });
  router.get("/:id", async (req, res) => {
    res.json(
      toServiceDTO(await getServiceDoc(objectIdParam(req, "id", "Service")))
    );
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateService(
        objectIdParam(req, "id", "Service"),
        parse(serviceUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/:id", async (req, res) => {
    await deleteService(objectIdParam(req, "id", "Service"), ctx(req));
    res.status(204).end();
  });
  return router;
}
