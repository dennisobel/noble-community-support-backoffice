import { Check, Info, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ServiceDTO } from "@shared/dto";
import { SERVICE_UNITS, type ServiceUnit } from "@shared/enums";
import { MESSAGES } from "@shared/messages";
import { errorMessage } from "@/api/client";
import {
  useCreateService,
  useDeleteService,
  useServices,
  useUpdateService,
  useWorkspace,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  Drawer,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  SectionHeading,
} from "@/components/app/ui";
import { money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

interface RowDraft {
  rate: string;
  transport: boolean;
  active: boolean;
  budgetCategory: string;
}

function AddServiceDrawer({ onClose }: { onClose: () => void }) {
  const notify = useNotify();
  const workspace = useWorkspace();
  const create = useCreateService();
  const categories = workspace.data?.budgetCategories ?? [];
  const [draft, setDraft] = useState({
    name: "",
    unit: "Hour" as ServiceUnit,
    rate: "",
    transport: true,
    active: true,
    budgetCategory: "",
    supportItemNumber: "",
  });
  const [error, setError] = useState("");
  const category = draft.budgetCategory || categories[0] || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const rate = Number(draft.rate);
    if (!draft.name.trim()) return setError(MESSAGES.serviceName);
    if (!draft.rate.trim() || !Number.isFinite(rate) || rate < 0)
      return setError(MESSAGES.serviceRate);
    try {
      const created = await create.mutateAsync({
        name: draft.name.trim(),
        unit: draft.unit,
        rate,
        transport: draft.transport,
        active: draft.active,
        budgetCategory: category,
        supportItemNumber: draft.supportItemNumber.trim() || undefined,
      });
      notify(`${created.name} added to service rates.`);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow="Service catalogue"
      title="Add service"
      subtitle="Create a service type for records, roster entries and rate estimates."
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" form="add-service-form" loading={create.isPending}>
            <Check size={14} />
            Save service
          </Btn>
        </div>
      }
    >
      <form id="add-service-form" className="space-y-5" onSubmit={submit}>
        <FormAlert message={error} />
        <Panel title="Service details">
          <div className="space-y-4 p-5">
            <div>
              <label className="label" htmlFor="new-service-name">
                Service name <span className="text-red-600">*</span>
              </label>
              <input
                id="new-service-name"
                className="input"
                autoFocus
                value={draft.name}
                onChange={event =>
                  setDraft(old => ({ ...old, name: event.target.value }))
                }
                placeholder="e.g. Household tasks"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="new-service-unit">
                  Billing unit
                </label>
                <select
                  id="new-service-unit"
                  className="select"
                  value={draft.unit}
                  onChange={event =>
                    setDraft(old => ({
                      ...old,
                      unit: event.target.value as ServiceUnit,
                    }))
                  }
                >
                  {SERVICE_UNITS.map(unit => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="new-service-rate">
                  Rate (AUD) <span className="text-red-600">*</span>
                </label>
                <input
                  id="new-service-rate"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.rate}
                  onChange={event =>
                    setDraft(old => ({ ...old, rate: event.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="label" htmlFor="new-service-category">
                  Budget category <span className="text-red-600">*</span>
                </label>
                <select
                  id="new-service-category"
                  className="select"
                  value={category}
                  onChange={event =>
                    setDraft(old => ({
                      ...old,
                      budgetCategory: event.target.value,
                    }))
                  }
                >
                  {categories.map(name => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <p className="field-help">
                  Spend on this service counts against this plan category.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="new-service-item">
                  NDIS support item number
                </label>
                <input
                  id="new-service-item"
                  className="input"
                  value={draft.supportItemNumber}
                  onChange={event =>
                    setDraft(old => ({
                      ...old,
                      supportItemNumber: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </div>
            </div>
            <label className="flex items-start gap-2 rounded-md bg-[#f5f8f7] p-3 text-xs text-[#586c74]">
              <input
                type="checkbox"
                className="mt-0.5 accent-[#147f79]"
                checked={draft.transport}
                onChange={event =>
                  setDraft(old => ({ ...old, transport: event.target.checked }))
                }
              />
              <span>
                <b className="block text-[#405761]">Transport may be claimed</b>
                <small className="mt-1 block text-[10px] text-[#839097]">
                  Provider travel is billed per kilometre at the workspace
                  travel rate ({money(workspace.data?.providerTravelRate ?? 1)}
                  /km).
                </small>
              </span>
            </label>
            <label className="flex items-center justify-between border-t border-[#edf0ef] pt-4 text-xs text-[#52666f]">
              <span>
                <b className="block text-[#405761]">Active service</b>
                <small className="mt-1 block text-[10px] text-[#839097]">
                  Active services appear in new records and roster entries.
                </small>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#147f79]"
                checked={draft.active}
                onChange={event =>
                  setDraft(old => ({ ...old, active: event.target.checked }))
                }
              />
            </label>
          </div>
        </Panel>
        <div className="rounded-md border border-[#e7ecea] bg-white p-3 text-[10px] leading-4 text-[#7c898f]">
          <Info size={13} className="mr-1 inline" />
          Verify applicable NDIS pricing before operational use. Rate changes
          apply to new and draft records; submitted records keep the rate they
          were submitted with.
        </div>
      </form>
    </Drawer>
  );
}

export default function ServicesPage() {
  const notify = useNotify();
  const services = useServices({ active: "all" });
  const workspace = useWorkspace();
  const update = useUpdateService();
  const remove = useDeleteService();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ServiceDTO | null>(null);
  const categories = workspace.data?.budgetCategories ?? [];

  const draftFor = (service: ServiceDTO): RowDraft =>
    drafts[service.id] ?? {
      rate: String(service.rate),
      transport: service.transport,
      active: service.active,
      budgetCategory: service.budgetCategory,
    };
  const change = (service: ServiceDTO, patch: Partial<RowDraft>) =>
    setDrafts(current => ({
      ...current,
      [service.id]: { ...draftFor(service), ...patch },
    }));
  const isDirty = (service: ServiceDTO) => {
    const draft = drafts[service.id];
    return (
      Boolean(draft) &&
      (Number(draft.rate) !== service.rate ||
        draft.transport !== service.transport ||
        draft.active !== service.active ||
        draft.budgetCategory !== service.budgetCategory)
    );
  };
  const save = async (service: ServiceDTO) => {
    const draft = draftFor(service);
    const rate = Number(draft.rate);
    if (!draft.rate.trim() || !Number.isFinite(rate) || rate < 0)
      return notify(MESSAGES.serviceRate, "error");
    try {
      await update.mutateAsync({
        id: service.id,
        rev: service.rev,
        rate,
        transport: draft.transport,
        active: draft.active,
        budgetCategory: draft.budgetCategory,
      });
      setDrafts(current => {
        const next = { ...current };
        delete next[service.id];
        return next;
      });
      notify(
        `${service.name} saved. New and draft records use the updated rate.`
      );
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <>
      <SectionHeading
        title="Services & rates"
        subtitle="Service types, billing units, rates and the plan budget category each one draws from."
        actions={
          <Btn onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add service
          </Btn>
        }
      />
      {services.isError && (
        <ErrorBlock error={services.error} onRetry={() => services.refetch()} />
      )}
      <Panel>
        {services.isPending ? (
          <LoadingBlock />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service name</th>
                  <th>Billing unit</th>
                  <th>Rate</th>
                  <th>Budget category</th>
                  <th>Transport</th>
                  <th>Active</th>
                  <th>Last updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(services.data ?? []).map(service => {
                  const draft = draftFor(service);
                  const dirty = isDirty(service);
                  return (
                    <tr key={service.id}>
                      <td className="font-semibold text-[#40535e]">
                        {service.name}
                        {service.supportItemNumber && (
                          <small className="mt-1 block text-[10px] font-normal text-[#87949a]">
                            {service.supportItemNumber}
                          </small>
                        )}
                      </td>
                      <td>{service.unit}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input h-8 w-24 py-1"
                          value={draft.rate}
                          onChange={event =>
                            change(service, { rate: event.target.value })
                          }
                          aria-label={`${service.name} rate`}
                        />
                      </td>
                      <td>
                        <select
                          className="select h-8 w-[170px] py-1 text-xs"
                          value={draft.budgetCategory}
                          onChange={event =>
                            change(service, {
                              budgetCategory: event.target.value,
                            })
                          }
                          aria-label={`${service.name} budget category`}
                        >
                          {[
                            ...new Set([...categories, service.budgetCategory]),
                          ].map(name => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="accent-[#147f79]"
                            checked={draft.transport}
                            onChange={event =>
                              change(service, {
                                transport: event.target.checked,
                              })
                            }
                            aria-label={`${service.name} transport enabled`}
                          />
                          {draft.transport ? "Per km" : "—"}
                        </label>
                      </td>
                      <td>
                        <button
                          onClick={() =>
                            change(service, { active: !draft.active })
                          }
                          className={`badge ${draft.active ? "badge-approved" : "badge-draft"}`}
                        >
                          {draft.active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td>{prettyDate(service.updatedAt.slice(0, 10))}</td>
                      <td>
                        <div className="flex gap-1">
                          <button
                            className="icon-btn"
                            disabled={!dirty || update.isPending}
                            onClick={() => void save(service)}
                            title="Save changes"
                            aria-label={`Save ${service.name}`}
                          >
                            <Check
                              size={14}
                              className={dirty ? "text-[#147f79]" : ""}
                            />
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => setDeleting(service)}
                            title="Delete service"
                            aria-label={`Delete ${service.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!services.data?.length && (
              <div className="p-8 text-center text-xs text-[#7b8990]">
                No services yet.{" "}
                <button
                  className="font-semibold text-[#277c76]"
                  onClick={() => setAdding(true)}
                >
                  Add the first service
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>
      <div className="mt-4 rounded-md border border-[#e7ecea] bg-white p-4 text-[11px] text-[#687982]">
        <Info size={14} className="mr-1 inline" />
        Edit a row, then select the check mark to save. Rates apply to new and
        draft records; submitted and approved records keep the billable lines
        they were submitted with.
      </div>
      {adding && <AddServiceDrawer onClose={() => setAdding(false)} />}
      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          body="Services that are already used by records or shifts cannot be deleted; mark them inactive instead."
          confirmLabel="Delete service"
          danger
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                notify(`${deleting.name} deleted.`);
                setDeleting(null);
              },
              onError: failure => {
                notify(errorMessage(failure), "error");
                setDeleting(null);
              },
            })
          }
        />
      )}
    </>
  );
}
