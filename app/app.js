// Main App Entry
const { useState, useEffect } = React;

const App = () => {
    const [currentTab, setCurrentTab] = useState('home');

    const renderContent = () => {
        switch (currentTab) {
            case 'feed': return <MorningAlertFeed />;
            case 'map': return <HerdMap />;
            case 'log': return <DataEntryLog />;
            case 'impact': return <SustainabilityImpact />;
            default: return <MorningAlertFeed />;
        }
    };

    // Homepage renders full-width without the sidebar Layout
    if (currentTab === 'home') {
        return <Homepage onNavigate={setCurrentTab} />;
    }

    return (
        <Layout currentTab={currentTab} onTabChange={setCurrentTab}>
            {renderContent()}
        </Layout>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
