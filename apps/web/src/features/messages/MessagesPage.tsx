import { useParams } from "wouter";
import { SectionHeading } from "@/components/app/ui";
import MessagesWorkspace from "./MessagesWorkspace";

/** Messages in the back office: with workers, with colleagues, and announcements to the team. */
export default function MessagesPage() {
  const params = useParams<{ id?: string }>();
  return (
    <>
      <SectionHeading
        title="Messages"
        subtitle="Conversations with support workers and colleagues. Only the people in a conversation can read it."
      />
      <MessagesWorkspace base="/app/messages" id={params.id} />
    </>
  );
}
