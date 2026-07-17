import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type RefreshHandler = () => Promise<void>;

interface RefreshContextType {
    registerRefreshHandler: (handler: RefreshHandler) => void;
    unregisterRefreshHandler: (handler: RefreshHandler) => void;
    onRefresh: () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextType | undefined>(undefined);

export const RefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Use a ref to store the current handler to avoid stale closures and dependency issues
    const handlerRef = useRef<RefreshHandler | null>(null);

    const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
        console.log('RefreshContext: Registering handler');
        handlerRef.current = handler;
    }, []);

    const unregisterRefreshHandler = useCallback((handler: RefreshHandler) => {
        if (handlerRef.current === handler) {
            console.log('RefreshContext: Unregistering handler');
            handlerRef.current = null;
        }
    }, []);

    const onRefresh = useCallback(async () => {
        console.log('RefreshContext: onRefresh called');
        if (handlerRef.current) {
            console.log('RefreshContext: Executing handler');
            await handlerRef.current();
            console.log('RefreshContext: Handler execution complete');
        } else {
            console.warn('RefreshContext: No handler registered');
        }
    }, []);

    return (
        <RefreshContext.Provider value={{ registerRefreshHandler, unregisterRefreshHandler, onRefresh }}>
            {children}
        </RefreshContext.Provider>
    );
};

export const useRefresh = () => {
    const context = useContext(RefreshContext);
    if (!context) {
        throw new Error('useRefresh must be used within a RefreshProvider');
    }
    return context;
};

// Helper hook for components to easily register their refresh logic
export const usePullToRefresh = (handler: RefreshHandler) => {
    const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();

    React.useEffect(() => {
        registerRefreshHandler(handler);
        return () => unregisterRefreshHandler(handler);
    }, [handler, registerRefreshHandler, unregisterRefreshHandler]);
};
