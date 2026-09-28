import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, CircleDollarSign, FileText, FolderClosed, FolderOpen, HardDrive, Info, Search, Upload, Users } from "lucide-react";
import type { Participant, ServiceRecord } from "@/lib/mock-data";

type NodeKind = "folder" | "record" | "reference" | "template" | "external";
type LibraryNode = {
  id: string;
  title: string;
  description?: string;
  kind: NodeKind;
  children?: LibraryNode[];
  badge?: string;
  recordId?: string;
  clientId?: string;
};

type Props = {
  participants: Participant[];
  records: ServiceRecord[];
  participant?: Participant;
  businessOnly?: boolean;
  onOpenProfile?: (id: string) => void;
  onOpenRecord?: (id: string) => void;
  notify: (message: string) => void;
};

const monthNames: Array<[string, string]> = [["09", "September"], ["10", "October"], ["11", "November"]];
const dateLabel = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";
const initials = (name: string) => name.split(" ").map(part => part[0]).slice(0, 2).join("").toUpperCase();

function makeParticipantFolder(participant: Participant, index: number, records: ServiceRecord[]): LibraryNode {
  const clientRecords = records.filter(record => record.clientId === participant.id);
  const months = monthNames.map(([month, label]) => ({
    id: `${participant.id}-notes-${month}`,
    title: label,
    description: `Progress notes filed for ${label} 2026.`,
    kind: "folder" as const,
    children: clientRecords.filter(record => record.date.startsWith(`2026-${month}`)).map(record => ({
      id: `${participant.id}-${record.id}`,
      title: `${record.id} · ${record.type}`,
      description: `${dateLabel(record.date)} · ${record.status} · linked portal record`,
      kind: "record" as const,
      recordId: record.id,
      clientId: participant.id,
    })),
  }));
  const travelMonths = monthNames.map(([month, label]) => ({
    id: `${participant.id}-travel-${month}`,
    title: label,
    description: `Travel records for ${label} 2026.`,
    kind: "folder" as const,
    children: clientRecords.filter(record => record.date.startsWith(`2026-${month}`) && record.km > 0).map(record => ({
      id: `${participant.id}-travel-${record.id}`,
      title: `${record.id} · ${record.km.toFixed(1)} km`,
      description: `${dateLabel(record.date)} · linked service record`,
      kind: "record" as const,
      recordId: record.id,
      clientId: participant.id,
    })),
  }));

  return {
    id: `client-${participant.id}`,
    title: `Client ${String(index + 1).padStart(3, "0")} – ${initials(participant.name)}`,
    description: `${participant.name} · preferred name ${participant.preferred}`,
    kind: "folder",
    clientId: participant.id,
    children: [
      { id: `${participant.id}-profile`, title: "01 Participant Profile", description: "Profile, contacts, preferences and alerts.", kind: "folder", clientId: participant.id, children: [
        { id: `${participant.id}-profile-link`, title: "Participant profile in Noble", description: "Open the in-app participant profile.", kind: "reference", clientId: participant.id },
      ] },
      { id: `${participant.id}-agreement`, title: "02 Service Agreement & Consent", description: "Signed service agreements and consent forms.", kind: "folder", badge: participant.kyc ? participant.kyc.serviceAgreement && participant.kyc.consentForms ? "Received" : "Pending" : undefined, children: [] },
      { id: `${participant.id}-plans`, title: "03 Support Plans & Goals", description: "Current plan, goals and review documents.", kind: "folder", badge: participant.kyc ? participant.kyc.supportPlan ? "Received" : "Pending" : undefined, clientId: participant.id, children: [
        { id: `${participant.id}-goals-link`, title: "Current goals and support summary", description: `${participant.goals.length} goals · available in the participant profile.`, kind: "reference", clientId: participant.id },
      ] },
      { id: `${participant.id}-notes`, title: "04 Progress Notes", description: "Linked service notes organized by year and month.", kind: "folder", children: [
        { id: `${participant.id}-notes-2026`, title: "2026", description: "Progress-note folders for the 2026 calendar year.", kind: "folder", children: months },
      ] },
      { id: `${participant.id}-incidents`, title: "05 Incidents & Hazards", description: "Incident reports, hazard records and follow-up.", kind: "folder", badge: participant.kyc ? participant.kyc.riskInformationReviewed ? "Reviewed" : "Check required" : undefined, children: [] },
      { id: `${participant.id}-transport`, title: "06 Transport & Kilometres", description: "Travel and kilometre entries linked to service records.", kind: "folder", badge: participant.kyc ? participant.kyc.transportRequirementsConfirmed ? "Confirmed" : "Pending" : undefined, children: [
        { id: `${participant.id}-transport-2026`, title: "2026", description: "Transport entries for the 2026 calendar year.", kind: "folder", children: travelMonths },
      ] },
      { id: `${participant.id}-correspondence`, title: "07 Correspondence", description: "Participant and nominee correspondence.", kind: "folder", children: [] },
    ],
  };
}

function buildLibrary(participants: Participant[], records: ServiceRecord[], businessOnly = false): LibraryNode {
  const businessFolders = ["Policies & Procedures", "Insurance", "Worker Checks", "NDIS Documents"].map((title, index) => ({ id: `business-${index}`, title, description: `Organization-wide ${title.toLowerCase()} documents.`, kind: "folder" as const, children: [] }));
  const templateFiles = ["Progress Note Template", "Incident Report", "Service Agreement", "Consent Forms"].map((title, index) => ({ id: `template-${index}`, title, description: "Template placeholder · add the approved source file when storage is connected.", kind: "template" as const, badge: "No file attached" }));
  return {
    id: "library-root",
    kind: "folder",
    title: businessOnly ? "Organisation files" : "Document library",
    description: businessOnly ? "Policies, finance references and reusable organisation templates." : "Participant and organisation document folders.",
    children: [
      ...(!businessOnly ? [{ id: "participants-root", title: "01 PARTICIPANTS", description: "Participant folders · one folder per client.", kind: "folder" as const, children: participants.map((person, index) => makeParticipantFolder(person, index, records)) }] : []),
      { id: "business-root", title: "02 BUSINESS DOCUMENTS", description: "Organization-wide policy, insurance, worker and NDIS files.", kind: "folder", children: businessFolders },
      { id: "finance-root", title: "03 FINANCE", description: "Accounting records and finance references.", kind: "folder", children: [
        { id: "xero-records", title: "Xero / accounting records", description: "External accounting records · Xero is not connected in this prototype.", kind: "external", badge: "Not connected", children: [] },
      ] },
      { id: "templates-root", title: "04 TEMPLATES", description: "Approved reusable forms and note templates.", kind: "folder", children: templateFiles },
    ],
  };
}

function childCount(node: LibraryNode): number {
  return (node.children ?? []).reduce((total, child) => total + (child.kind === "folder" ? Math.max(1, childCount(child)) : 1), 0);
}

export default function DocumentLibrary({ participants, records, participant, businessOnly = false, onOpenProfile, onOpenRecord, notify }: Props) {
  const root = useMemo(() => buildLibrary(participants, records, businessOnly), [participants, records, businessOnly]);
  const selectedClientFolder = useMemo(() => participant ? makeParticipantFolder(participant, Math.max(0, participants.findIndex(person => person.id === participant.id)), records) : undefined, [participant, participants, records]);
  const rootNode = participant && selectedClientFolder ? selectedClientFolder : root;
  const [path, setPath] = useState<LibraryNode[]>(() => [rootNode]);
  useEffect(() => {
    setPath(previous => {
      const resolved: LibraryNode[] = [rootNode];
      for (const oldNode of previous.slice(1)) {
        const match = (resolved[resolved.length - 1].children ?? []).find(item => item.id === oldNode.id);
        if (!match) break;
        resolved.push(match);
      }
      return resolved;
    });
  }, [rootNode]);
  const [search, setSearch] = useState("");
  const current = path[path.length - 1] ?? rootNode;
  const listedItems = (current.children ?? []).filter(item => `${item.title} ${item.description ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  const open = (item: LibraryNode) => {
    if (item.kind === "folder") { setPath(previous => [...previous, item]); return; }
    if (item.kind === "external") { notify("Xero is not connected. No accounting records are being synced."); return; }
    if (item.kind === "record" && item.recordId) { onOpenRecord?.(item.recordId); return; }
    if (item.kind === "reference" && item.clientId) { onOpenProfile?.(item.clientId); return; }
    notify("This is a template placeholder. Secure document storage and preview are not connected yet.");
  };

  return <div className="space-y-4">
    {!participant ? <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="page-title serif">{businessOnly ? "Organisation files" : "Document library"}</h1><p className="page-subtitle">{businessOnly ? "Organisation-wide business records, finance and templates. Client documents live inside each client profile." : "A clear home for participant files, business records, finance and templates."}</p></div><button className="btn btn-secondary" onClick={() => notify("Secure uploads are not connected in this prototype.")}><Upload size={14}/>Upload document</button></div> : <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="panel-title">Participant documents</h3><p className="mt-1 text-[11px] text-[#819097]">{current.title} · folders are linked to this participant.</p></div><button className="btn btn-secondary !h-8 !px-3 text-[11px]" onClick={() => notify("Secure uploads are not connected in this prototype.")}><Upload size={13}/>Add document</button></div>}

    <div className="panel p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[11px]" aria-label="Document folder breadcrumb">
          {path.map((node, index) => <span key={`${node.id}-${index}`} className="inline-flex items-center gap-1"><button className={`rounded px-1.5 py-1 ${index === path.length - 1 ? "font-semibold text-[#254d52]" : "text-[#74848b] hover:bg-[#f2f6f4] hover:text-[#277c76]"}`} onClick={() => setPath(path.slice(0, index + 1))}>{node.title}</button>{index < path.length - 1 && <ChevronRight size={12} className="text-[#9aa6a8]"/>}</span>)}
        </nav>
        <div className="relative min-w-[190px] flex-1 sm:max-w-[280px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89969b]"/><input className="input h-9 pl-9 text-xs" placeholder="Search this folder" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search this folder"/></div>
      </div>
      {path.length > 1 && <button className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[#277c76]" onClick={() => setPath(path.slice(0, -1))}><ArrowLeft size={12}/>Up one folder</button>}
    </div>

    <div className="rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[10px] leading-4 text-[#496663]"><Info size={13} className="mr-1.5 inline"/>{participant ? "This folder is limited to the selected client. Progress notes and travel entries are linked records, not duplicate files." : businessOnly ? "Organisation files only. Client folders are managed from each client profile. Secure uploads and Xero sync are not connected." : "Folder structure only — secure uploads, document storage, and Xero sync are not connected. Existing portal progress notes appear as linked records, not duplicate files."}</div>

    {listedItems.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{listedItems.map(item => {
      const isFolder = item.kind === "folder";
      const Icon = isFolder ? (path.length > 1 ? FolderClosed : item.id === "participants-root" ? Users : item.id === "finance-root" ? CircleDollarSign : FolderOpen) : item.kind === "external" ? HardDrive : FileText;
      const count = isFolder ? childCount(item) : undefined;
      return <button key={item.id} className="panel group flex min-h-[112px] items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#bfd9d3] hover:shadow-[0_8px_24px_rgba(25,70,67,.07)]" onClick={() => open(item)}>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${item.kind === "external" ? "bg-[#fff4de] text-[#a6782d]" : isFolder ? "bg-[#edf5f2] text-[#3c8177]" : "bg-[#eef2f6] text-[#617993]"}`}><Icon size={18}/></span>
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-[#344854] group-hover:text-[#147c76]">{item.title}</span>{item.badge&&<span className={`badge ${item.kind === "external" ? "badge-returned" : item.badge === "Received" || item.badge === "Confirmed" || item.badge === "Reviewed" ? "badge-approved" : "badge-draft"}`}>{item.badge}</span>}</span><span className="mt-1 block text-[10px] leading-4 text-[#7c8a90]">{item.description}</span><span className="mt-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[#96a2a5]">{isFolder ? `${count} ${count === 1 ? "item" : "items"}` : item.kind === "record" ? "Linked record" : item.kind === "reference" ? "Portal reference" : item.kind === "external" ? "External source" : "Template"}{isFolder&&<ChevronRight size={11} className="ml-auto text-[#a5b0b1]"/>}</span></span>
      </button>;
    })}</div> : <div className="panel px-5 py-10 text-center"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#f1f5f3] text-[#82938f]"><FolderOpen size={18}/></div><b className="text-xs text-[#40545e]">{search ? "No matching folders or records" : current.kind === "external" ? "Accounting source not connected" : "This folder is ready for documents"}</b><p className="mt-1 text-[10px] text-[#87949a]">{search ? "Try another search term." : current.kind === "external" ? "Connect Xero to sync accounting data, or keep accounting records in your approved finance archive." : "The folder structure is in place; uploaded files will appear here once secure storage is connected."}</p></div>}
  </div>;
}
