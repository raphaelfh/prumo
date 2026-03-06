/**
 * StableTabs - Tabs with stable height to avoid layout shift.
 *
 * Usage:
 * <StableTabs
 *   tabs={[
 *     { value: "overview", label: "Overview", content: <Overview /> },
 *     { value: "analytics", label: "Analytics", content: <Analytics /> },
 *   ]}
 *   defaultValue="overview"
 *   minHeight="400px"
 * />
 */

import React from 'react';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {cn} from '@/lib/utils';

interface Tab {
  value: string;
  label: string;
  content: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
}

interface StableTabsProps {
  tabs: Tab[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  minHeight?: string;
  className?: string;
}

export function StableTabs({ 
  tabs, 
  defaultValue, 
  value,
  onValueChange,
  minHeight = '400px',
  className 
}: StableTabsProps) {
  return (
    <Tabs 
      defaultValue={defaultValue} 
      value={value}
      onValueChange={onValueChange}
      className={className}
    >
      <TabsList>
        {tabs.map(tab => (
          <TabsTrigger 
            key={tab.value} 
            value={tab.value}
            disabled={tab.disabled}
          >
            {tab.icon && <span className="mr-2">{tab.icon}</span>}
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      
      {tabs.map(tab => (
        <TabsContent 
          key={tab.value} 
          value={tab.value}
          className={cn(
            "overflow-y-auto",
            minHeight && `min-h-[${minHeight}]`
          )}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

