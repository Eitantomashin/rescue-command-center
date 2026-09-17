"use client";
import { createContext, useContext } from "react";
export const EquipmentRefreshContext = createContext(0);
export function useEquipmentRevision() { return useContext(EquipmentRefreshContext); }
