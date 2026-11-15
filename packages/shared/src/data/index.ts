import route from "./earthMoon.json";
import nasaSources from "./nasaSources.json";
import nasaFacts from "./nasaFacts.json";
import education from "./education.json";
import type { AttachmentId } from "../types";

export interface NasaSource {
  id: string;
  title: string;
  sourceType: "pdf" | "web" | "text" | "software";
  officialUrl?: string;
  localReference?: string;
  version?: string;
  accessedOn?: string;
}
export interface NasaFact {
  id: string;
  title: string;
  text: string;
  topic: "mission-design" | "propulsion" | "power" | "shielding" | "navigation" | "lunar-science";
  sourceIds: string[];
  sourceLocations: string[];
}
export interface AttachmentEducation {
  attachmentId: AttachmentId | "repair-drone";
  explanation: string;
  realWorldPrinciple: string;
  gameplayAbstraction: string;
  sourceIds: string[];
}
export interface RouteDefinition {
  id: "earth-moon";
  distanceUnits: number;
  referenceSpeed: number;
  visualScale: number;
  controlPoints: [number, number, number][];
  earthPosition: [number, number, number];
  earthRadius: number;
  moonPosition: [number, number, number];
  moonRadius: number;
  sourceIds: string[];
  note: string;
}

export const ROUTE = route as RouteDefinition;
export const NASA_SOURCES = nasaSources as NasaSource[];
export const NASA_FACTS = nasaFacts as NasaFact[];
export const ATTACHMENT_EDUCATION = education as AttachmentEducation[];
