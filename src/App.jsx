import React, { useState, useEffect, useRef } from 'react';
import { 
  Car, User, Clock, LogIn, LogOut, History, Trash2,
  AlertCircle, CheckCircle2, Truck, Boxes, Container,
  Zap, Calendar, Filter, X, FileText, Download,
  Search, LayoutGrid, Settings, Palette, Type,
  Image as ImageIcon, Upload, Link as LinkIcon, Plus,
  Users, Sparkles, Loader2, BrainCircuit, Lock,
  UserCircle, ShieldCheck, Cloud
} from 'lucide-react';

// FIREBASE IMPORTS
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

const appId = typeof __app_id !== 'undefined' ? __app_id : 'portaria-cristal-sul-cloud-v3';

// FIREBASE INITIALIZATION
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_SETTINGS = {
  title: "PORTARIA",
  subtitle: "Cristal Sul",
  logoUrl: "https://drive.google.com/uc?id=1zOu_7gucqM__vSagDs0WvcK5fuetdmZ_",
  brandColor: "#002E63"
};

const INITIAL_CATEGORIES = [
  { id: 'TRUCK', label: 'Truck', group: 'heavy' },
  { id: 'CARRETA', label: 'Carreta', group: 'heavy' },
  { id: 'TOCO', label: 'Toco', group: 'medium' },
  { id: '3/4', label: '3/4', group: 'medium' },
  { id: 'UTILITARIO', label: 'Utilitário', group: 'medium' },
  { id: 'CARRO', label: 'Carro de Passeio', group: 'other' },
  { id: 'MOTO', label: 'Moto', group: 'other' },
  { id: 'OUTROS', label: 'Outros', group: 'other' },
];

const GROUPS = [
  { id: 'heavy', label: 'Pesados' },
  { id: 'medium', label: 'Médios' },
  { id: 'other', label: 'Pátio' },
];

const AVAILABLE_PERMISSIONS = [
  { id: 'identity', label: 'Identidade Visual' },
  { id: 'system_users', label: 'Usuários do Sistema' },
  { id: 'vehicles', label: 'Placas Registradas' },
  { id: 'types', label: 'Categorias de Veículos' },
  { id: 'drivers', label: 'Motoristas' }
];

const DEFAULT_USERS = [
  { id: '1', username: 'admin', password: '123', name: 'Administrador', permissions: ['identity', 'system_users', 'vehicles', 'types', 'drivers'] }
];

// Gemini API Helper
const callGemini = async (prompt, isJson = false, schema = null) => {
  const apiKey = ""; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };

  if (isJson && schema) {
    payload.generationConfig = { responseMimeType: "application/json", responseSchema: schema };
  }

  let retries = 0;
  const maxRetries = 5;
  const delays = [1000, 2000, 4000, 8000, 16000];

  while (retries <= maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Sem resposta gerada");
      
      return isJson ? JSON.parse(text) : text;
    } catch (error) {
      if (retries === maxRetries) throw error;
      await new Promise(res => setTimeout(res, delays[retries]));
      retries++;
    }
  }
};

export default function App() {
  // Autenticação Ambiente e Estado Banco de Dados
  const [envUser, setEnvUser] = useState(null);
  const [isDbReady, setIsDbReady] = useState(false);

  // Autenticação Local do App
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Estados Principais (Sincronizados via Firestore)
  const [activeVehicles, setActiveVehicles] = useState([]);
  const [history, setHistory] = useState([]);
  const [knownVehicles, setKnownVehicles] = useState({}); 
  const [knownDrivers, setKnownDrivers] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  
  // Rascunho para Configurações (Evita writes excessivos no DB)
  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);

  // Estados Formulário
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [notification, setNotification] = useState(null);
  const [view, setView] = useState('active'); 
  const [managerSubView, setManagerSubView] = useState('identity');
  const fileInputRef = useRef(null);

  // Estados Gerenciais
  const [newSysUserName, setNewSysUserName] = useState('');
  const [newSysUserLogin, setNewSysUserLogin] = useState('');
  const [newSysUserPass, setNewSysUserPass] = useState('');
  const [newSysUserPermissions, setNewSysUserPermissions] = useState([]);
  const [newDriverName, setNewDriverName] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [newTypeGroup, setNewTypeGroup] = useState('other');

  // Estados Gemini AI
  const [aiInputText, setAiInputText] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState(null);

  // Filtros
  const [filterDate, setFilterDate] = useState('');
  const [filterType, setFilterType] = useState('entry');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterCatDetail, setFilterCatDetail] = useState('all');
  const [isReportOpen, setIsReportOpen] = useState(false);

  // 1. Inicializa Autenticação de Ambiente Firebase
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Erro na autenticação de ambiente:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setEnvUser);
    return () => unsubscribe();
  }, []);

  // 2. Sincronização em Tempo Real (Firestore)
  useEffect(() => {
    if (!envUser) return;

    const publicPath = (colName) => collection(db, 'artifacts', appId, 'public', 'data', colName);

    const unsubActive = onSnapshot(publicPath('activeVehicles'), (snap) => {
      const data = snap.docs.map(d => d.data());
      setActiveVehicles(data.sort((a,b) => b.timestamp - a.timestamp));
    }, console.error);

    const unsubHistory = onSnapshot(publicPath('history'), (snap) => {
      const data = snap.docs.map(d => d.data());
      setHistory(data.sort((a,b) => b.timestamp - a.timestamp));
    }, console.error);

    const unsubKnownVeh = onSnapshot(publicPath('knownVehicles'), (snap) => {
       const obj = {};
       snap.docs.forEach(d => { obj[d.id] = d.data(); });
       setKnownVehicles(obj);
    }, console.error);

    const unsubConfig = onSnapshot(publicPath('config'), (snap) => {
      let loadedUsers = DEFAULT_USERS;
      let loadedTypes = INITIAL_CATEGORIES;
      let loadedSettings = DEFAULT_SETTINGS;
      let loadedDrivers = [];
      let hasUsers = false;

      snap.docs.forEach(d => {
          const data = d.data();
          if (d.id === 'appUsers' && data.list) { loadedUsers = data.list; hasUsers = true; }
          if (d.id === 'types' && data.list) loadedTypes = data.list;
          if (d.id === 'settings' && Object.keys(data).length > 0) loadedSettings = data;
          if (d.id === 'drivers' && data.list) loadedDrivers = data.list;
      });

      setUsers(loadedUsers);
      setVehicleTypes(loadedTypes);
      setSettings(loadedSettings);
      setDraftSettings(loadedSettings);
      setKnownDrivers(loadedDrivers);

      // Popula dados base na primeira inicialização do banco vazio
      if (!hasUsers) {
          setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'appUsers'), { list: DEFAULT_USERS });
          setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'types'), { list: INITIAL_CATEGORIES });
          setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings'), DEFAULT_SETTINGS);
      }

      setIsDbReady(true);
    }, console.error);

    return () => { unsubActive(); unsubHistory(); unsubKnownVeh(); unsubConfig(); };
  }, [envUser]);

  // Restaura sessão local (Permanece logado ao atualizar F5)
  useEffect(() => {
    const savedSession = sessionStorage.getItem(`${appId}_session`);
    if (savedSession) setCurrentUser(JSON.parse(savedSession));
  }, []);

  const notify = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Funções de Helpers para Escrita no Firestore
  const updateConfigList = (docId, newList) => {
    setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', docId), { list: newList });
  };

  // Autenticação
  const handleLogin = (e) => {
    e.preventDefault();
    const user = users.find(u => u.username === loginUsername && u.password === loginPassword);
    if (user) {
      setCurrentUser(user);
      sessionStorage.setItem(`${appId}_session`, JSON.stringify(user));
      setLoginUsername('');
      setLoginPassword('');
      notify(`Bem-vindo, ${user.name}!`);
    } else {
      notify("Usuário ou senha incorretos", "error");
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem(`${appId}_session`);
    notify("Sessão encerrada com sucesso.", "info");
  };

  // Gerenciamento de Usuários
  const addSystemUser = () => {
    if (!newSysUserName || !newSysUserLogin || !newSysUserPass) return notify("Preencha todos os campos", "error");
    if (users.find(u => u.username === newSysUserLogin)) return notify("Login já em uso", "error");
    
    updateConfigList('appUsers', [...users, {
      id: Date.now().toString(),
      name: newSysUserName,
      username: newSysUserLogin,
      password: newSysUserPass,
      permissions: newSysUserPermissions
    }]);
    
    setNewSysUserName(''); setNewSysUserLogin(''); setNewSysUserPass(''); setNewSysUserPermissions([]);
    notify("Usuário do sistema cadastrado!");
  };

  const removeSystemUser = (id) => {
    if (id === currentUser.id) return notify("Você não pode excluir a si mesmo", "error");
    if (users.length === 1) return notify("É necessário ter pelo menos 1 usuário", "error");
    updateConfigList('appUsers', users.filter(u => u.id !== id));
    notify("Usuário removido");
  };

  // Salvar Identidade
  const saveSettingsToDb = async () => {
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings'), draftSettings);
      notify("Configurações de Identidade Salvas na Nuvem!");
    } catch (error) {
      console.error(error);
      notify("Erro ao salvar. A imagem pode ser muito pesada.", "error");
    }
  };

  // IA Preenchimento Mágico
  const handleMagicFill = async () => {
    if (!aiInputText.trim()) return notify("Digite ou cole as informações primeiro.", "error");
    setIsAiLoading(true);
    try {
      const prompt = `Analise este texto de portaria: "${aiInputText}". Extraia a placa do veículo (A placa deve conter exatamente 7 caracteres, ex: ABC1234), o modelo/marca, e o nome do motorista. Além disso, escolha a categoria MAIS ADEQUADA da seguinte lista: ${vehicleTypes.map(t => t.id).join(', ')}.`;
      const schema = {
        type: "OBJECT",
        properties: {
          plate: { type: "STRING", description: "Placa limpa contendo apenas 7 letras e números (ex: ABC1234)" },
          model: { type: "STRING", description: "Modelo ou marca descrita" },
          driver: { type: "STRING", description: "Nome do motorista, primeira letra maiúscula" },
          categoryId: { type: "STRING", description: "O ID exato da categoria adequada" }
        }
      };

      const result = await callGemini(prompt, true, schema);
      let foundKnown = false;
      
      if (result.plate) {
        const cleanAiPlate = result.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
        setPlate(cleanAiPlate);
        if (cleanAiPlate.length < 7) notify("Atenção: A IA extraiu uma placa incompleta.", "error");
        
        if (knownVehicles[cleanAiPlate]) {
          setModel(knownVehicles[cleanAiPlate].model);
          setCategory(knownVehicles[cleanAiPlate].category);
          foundKnown = true;
        }
      }
      
      if (result.driver) setDriver(result.driver.toUpperCase());
      
      if (!foundKnown) {
        if (result.model) setModel(result.model.toUpperCase());
        if (result.categoryId && vehicleTypes.find(t => t.id === result.categoryId)) {
          setCategory(result.categoryId);
        }
      }
      
      notify(foundKnown ? "✨ Dados preenchidos (Veículo conhecido)!" : "✨ Dados extraídos com sucesso!");
      setAiInputText('');
    } catch (error) {
      notify("Falha ao analisar o texto com IA.", "error");
    } finally {
      setIsAiLoading(false);
    }
  };

  // IA Insights
  const generateInsights = async (dataToAnalyze) => {
    if (dataToAnalyze.length === 0) return notify("Não há dados suficientes para analisar.", "error");
    setInsightsLoading(true);
    try {
      const sample = dataToAnalyze.slice(0, 50).map(v => ({
        tipo: vehicleTypes.find(t => t.id === v.category)?.label || v.category,
        permanencia: v.duration,
        entrada: v.entryTime
      }));

      const prompt = `Você é um analista logístico da portaria Cristal Sul. Analise esta amostra de histórico de veículos: ${JSON.stringify(sample)}. Escreva um breve resumo gerencial em português (max 3 parágrafos curtos) destacando: tipos de veículos mais comuns no período filtrado, uma estimativa simples do tempo de pátio (permanência) e se há alguma anomalia/observação.`;
      const result = await callGemini(prompt, false);
      setAiInsights(result);
      notify("✨ Insights gerados com sucesso!");
    } catch (error) {
      notify("Falha ao gerar insights.", "error");
    } finally {
      setInsightsLoading(false);
    }
  };

  // Gerenciamento Geral
  const addDriver = (name) => {
    if (!name.trim()) return;
    if (knownDrivers.includes(name.toUpperCase().trim())) return notify("Motorista já cadastrado", "error");
    updateConfigList('drivers', [...knownDrivers, name.toUpperCase().trim()].sort());
    notify("Motorista adicionado na nuvem");
  };

  const removeDriver = (name) => {
    updateConfigList('drivers', knownDrivers.filter(d => d !== name));
    notify("Motorista removido");
  };

  const addVehicleType = (label, group) => {
    const id = label.toUpperCase().replace(/\s+/g, '_');
    if (vehicleTypes.find(t => t.id === id)) return notify("Tipo já existe", "error");
    updateConfigList('types', [...vehicleTypes, { id, label, group }]);
    notify("Tipo adicionado na nuvem");
  };

  const removeVehicleType = (id) => {
    updateConfigList('types', vehicleTypes.filter(t => t.id !== id));
    notify("Tipo removido");
  };

  const updateKnownVehicle = (p, data) => {
    const currentData = knownVehicles[p] || {};
    setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'knownVehicles', p), { ...currentData, ...data });
    notify("Registro atualizado");
  };

  const removeKnownVehicle = (p) => {
    deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'knownVehicles', p));
    notify("Registro removido");
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 400; // Reduz a imagem automaticamente para caber na nuvem
        let width = img.width;
        let height = img.height;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          } else {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/png');
        
        if (dataUrl.length > 900000) { // O limite do banco de dados em nuvem é 1MB
            notify("A imagem ainda é muito pesada após conversão. Use outra.", "error");
            return;
        }

        setDraftSettings(prev => ({ ...prev, logoUrl: dataUrl }));
        notify("Imagem preparada! Clique em Salvar para enviar à nuvem.");
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handlePlateChange = (value) => {
    const rawPlate = value.toUpperCase().trim();
    setPlate(rawPlate);
    const searchPlate = rawPlate.replace(/[^A-Z0-9]/g, '');
    if (searchPlate.length >= 7 && knownVehicles[searchPlate]) {
      setModel(knownVehicles[searchPlate].model);
      setCategory(knownVehicles[searchPlate].category);
      notify("Veículo reconhecido na Nuvem!", "info");
    }
  };

  const handleEntry = (e) => {
    if(e) e.preventDefault();
    const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanDriver = driver.toUpperCase().trim();
    
    if (!cleanPlate || !cleanDriver || !model || !category) return notify("Preencha todos os campos.", "error");
    if (cleanPlate.length < 7) return notify("Placa inválida. Insira 7 caracteres.", "error");
    if (activeVehicles.find(v => v.plate.replace(/[^A-Z0-9]/g, '') === cleanPlate)) return notify("Veículo já está no pátio.", "error");
    
    const newEntry = {
      id: Date.now(),
      plate: cleanPlate, driver: cleanDriver, model, category,
      entryTime: new Date().toLocaleString('pt-BR'),
      entryOperator: currentUser.name,
      timestamp: Date.now()
    };

    // Salva a entrada
    setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'activeVehicles', newEntry.id.toString()), newEntry);

    // Salva ou atualiza a placa nos conhecidos
    if (!knownVehicles[cleanPlate] || knownVehicles[cleanPlate].model !== model || knownVehicles[cleanPlate].category !== category) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'knownVehicles', cleanPlate), { model, category });
    }

    // Adiciona motorista se for novo
    if (!knownDrivers.includes(cleanDriver)) {
      updateConfigList('drivers', [...knownDrivers, cleanDriver].sort());
    }

    setPlate(''); setDriver(''); setModel(''); setCategory('');
    notify("Entrada registrada e sincronizada!");
  };

  const handleExit = (vehicle) => {
    const exitTime = new Date().toLocaleString('pt-BR');
    const diffMs = Date.now() - vehicle.timestamp;
    const duration = `${Math.floor(diffMs / 3600000)}h ${Math.round(((diffMs % 3600000) / 60000))}m`;
    
    const historyRecord = { ...vehicle, exitTime, duration, exitOperator: currentUser.name };
    
    // Adiciona no histórico e deleta dos ativos
    setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'history', historyRecord.id.toString()), historyRecord);
    deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'activeVehicles', vehicle.id.toString()));
    
    notify("Saída registrada na Nuvem!");
  };

  const clearHistory = () => {
    if(confirm('Apagar todo o histórico de todos os usuários? Esta ação é irreversível.')) {
        history.forEach(record => {
            deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'history', record.id.toString()));
        });
        notify("Histórico apagado da Nuvem!");
    }
  }

  const resetFilters = () => {
    setFilterDate(''); setSearchTerm(''); setFilterGroup('all'); setFilterCatDetail('all');
  };

  const filteredHistory = history.filter(record => {
    if (filterDate) {
      const [year, month, day] = filterDate.split('-');
      const formattedFilterDate = `${day}/${month}/${year}`;
      const targetDateString = filterType === 'entry' ? record.entryTime : record.exitTime;
      if (!targetDateString.includes(formattedFilterDate)) return false;
    }
    if (searchTerm) {
      const s = searchTerm.toUpperCase();
      const match = record.plate.includes(s) || record.driver.toUpperCase().includes(s) || record.model.toUpperCase().includes(s);
      if (!match) return false;
    }
    if (filterGroup !== 'all') {
      const cat = vehicleTypes.find(c => c.id === record.category);
      if (cat?.group !== filterGroup) return false;
    }
    if (filterCatDetail !== 'all' && record.category !== filterCatDetail) return false;
    return true;
  });

  const heavyQueue = activeVehicles.filter(v => vehicleTypes.find(c => c.id === v.category)?.group === 'heavy').sort((a, b) => a.timestamp - b.timestamp);
  const mediumQueue = activeVehicles.filter(v => vehicleTypes.find(c => c.id === v.category)?.group === 'medium').sort((a, b) => a.timestamp - b.timestamp);
  const others = activeVehicles.filter(v => vehicleTypes.find(c => c.id === v.category)?.group === 'other').sort((a, b) => a.timestamp - b.timestamp);

  const VehicleCard = ({ vehicle, colorClass }) => (
    <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 hover:shadow-xl transition-all animate-in fade-in">
      <div className="flex justify-between items-start mb-3">
        <span className="bg-slate-900 text-white px-4 py-1 rounded-xl font-mono font-black text-lg tracking-tighter">
          {vehicle.plate}
        </span>
        <div className="flex flex-col items-end text-slate-400 font-bold text-[10px] uppercase bg-slate-50 px-2 py-1 rounded-lg">
          <div className="flex items-center">
            <Clock size={12} className="mr-1" /> {vehicle.entryTime.split(' ')[1]}
          </div>
          <div className="text-[8px] text-slate-300 mt-0.5 truncate max-w-[80px]" title={`Operador: ${vehicle.entryOperator}`}>
            POR: {vehicle.entryOperator?.split(' ')[0]}
          </div>
        </div>
      </div>
      <div className="mb-4">
        <h4 className="font-black text-slate-800 text-base uppercase truncate italic leading-tight">{vehicle.model}</h4>
        <p className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1 mt-1">
          <User size={12} className="text-slate-300" /> {vehicle.driver}
        </p>
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-slate-50">
        <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${colorClass}`}>
          {vehicleTypes.find(t => t.id === vehicle.category)?.label || vehicle.category}
        </span>
        <button 
          onClick={() => handleExit(vehicle)}
          style={{ backgroundColor: settings.brandColor }}
          className="text-[10px] font-black text-white hover:opacity-80 px-4 py-2 rounded-2xl transition-all uppercase flex items-center gap-2 active:scale-95"
        >
          <LogOut size={14} /> Registrar Saída
        </button>
      </div>
    </div>
  );

  const ReportModal = () => {
    if (!isReportOpen) return null;
    const reportData = [...heavyQueue, ...mediumQueue];
    const now = new Date().toLocaleString('pt-BR');
    
    return (
      <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden text-slate-900 animate-in zoom-in-95 duration-200">
          <style>
            {` @media print { .no-print { display: none !important; } body { background: white !important; } .print-container { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 0 !important; max-width: 100% !important; position: absolute; top: 0; left: 0; } } `}
          </style>
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 no-print">
            <div className="flex items-center gap-3">
              <FileText size={20} style={{ color: settings.brandColor }} />
              <h2 className="text-sm font-black uppercase tracking-widest">Relatório - {settings.subtitle}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => window.print()} 
                style={{ backgroundColor: settings.brandColor }}
                className="text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg flex items-center gap-2 transition-all"
              >
                <Download size={14} /> Gerar PDF
              </button>
              <button onClick={() => setIsReportOpen(false)} className="p-2 text-slate-400 hover:text-red-500 transition-all"><X size={24} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-12 text-center print-container">
            <img src={settings.logoUrl} alt="Logo" className="w-48 h-auto mx-auto mb-6 object-contain" />
            <h1 className="text-4xl font-black uppercase italic tracking-tighter leading-none">{settings.title}</h1>
            <p className="text-xl font-black uppercase tracking-[0.4em] mb-10" style={{ color: settings.brandColor }}>{settings.subtitle}</p>
            
            <div className="flex justify-center gap-8 text-[11px] font-bold text-slate-600 uppercase bg-slate-50 py-4 rounded-3xl border border-slate-100 w-full max-w-lg mx-auto mb-12">
              <span>Data: {now.split(',')[0]}</span>
              <span>Hora: {now.split(',')[1]}</span>
              <span>Fila Atual: {reportData.length} veículos</span>
            </div>

            <div className="space-y-12 text-left">
              {['heavy', 'medium'].map(groupType => {
                const groupQueue = groupType === 'heavy' ? heavyQueue : mediumQueue;
                const label = groupType === 'heavy' ? 'Pesados (Truck / Carreta)' : 'Médios (Toco / 3/4 / Util)';
                return (
                  <div key={groupType}>
                    <h3 className="text-xs font-black uppercase tracking-widest mb-4 border-b-2 pb-2" style={{ color: settings.brandColor, borderColor: `${settings.brandColor}20` }}>{label}</h3>
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-white">
                          <th className="py-3 px-4 font-black uppercase rounded-tl-xl">Placa</th>
                          <th className="py-3 px-4 font-black uppercase">Modelo</th>
                          <th className="py-3 px-4 font-black uppercase">Motorista</th>
                          <th className="py-3 px-4 font-black uppercase rounded-tr-xl">Entrada</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {groupQueue.length === 0 ? (
                          <tr><td colSpan="4" className="py-8 text-center text-slate-400 italic font-bold uppercase">Sem registros</td></tr>
                        ) : groupQueue.map(v => (
                          <tr key={v.id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-black text-slate-900">{v.plate}</td>
                            <td className="py-3 px-4 font-bold text-slate-700 uppercase italic">{v.model}</td>
                            <td className="py-3 px-4 font-bold text-slate-600">{v.driver}</td>
                            <td className="py-3 px-4 font-bold text-slate-500">{v.entryTime}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- TELA DE CARREGAMENTO DO BANCO ---
  if (!isDbReady) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <Loader2 className="animate-spin text-white mb-4" size={48} />
        <p className="text-white font-black text-xs uppercase tracking-widest animate-pulse">Sincronizando com a Nuvem...</p>
      </div>
    );
  }

  // --- TELA DE LOGIN ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        {notification && (
          <div className="fixed top-6 right-6 z-50 p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in text-white max-w-xs" style={{ backgroundColor: notification.type === 'error' ? '#ef4444' : settings.brandColor }}>
            <div className="bg-white/20 p-1.5 rounded-full shrink-0">
              {notification.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            </div>
            <span className="font-bold text-[11px] uppercase tracking-wide">{notification.message}</span>
          </div>
        )}

        <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
          <div className="h-2 w-full" style={{ backgroundColor: settings.brandColor }}></div>
          <div className="p-10 space-y-8">
            <div className="text-center space-y-4">
              <div className="w-24 h-24 mx-auto bg-slate-50 rounded-3xl flex items-center justify-center border border-slate-100 shadow-inner p-2 relative">
                <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-1.5 rounded-full shadow-lg" title="Conectado à Nuvem">
                  <Cloud size={14} />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-black italic tracking-tighter uppercase text-slate-900">{settings.title}</h1>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] mt-1" style={{ color: settings.brandColor }}>{settings.subtitle}</p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest flex items-center gap-1.5">
                  <UserCircle size={14} /> Usuário
                </label>
                <input type="text" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-bold text-sm transition-all" placeholder="Seu login" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest flex items-center gap-1.5">
                  <Lock size={14} /> Senha
                </label>
                <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-bold text-sm transition-all" placeholder="••••••••" />
              </div>
              <button type="submit" className="w-full text-white font-black py-4 rounded-2xl shadow-xl transition-all text-xs uppercase tracking-[0.2em] mt-4 hover:opacity-90 active:scale-95 flex justify-center items-center gap-2" style={{ backgroundColor: settings.brandColor }}>
                Acessar Sistema <LogIn size={16} />
              </button>
            </form>
          </div>
          <div className="bg-slate-50 p-4 text-center border-t border-slate-100 flex items-center justify-center gap-2 text-slate-400">
             <Cloud size={14} />
             <p className="text-[9px] font-bold uppercase tracking-widest">Conexão Segura em Tempo Real</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-slate-900 font-sans pb-24">
      {notification && (
        <div className="fixed top-6 right-6 z-50 p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in text-white max-w-xs" style={{ backgroundColor: notification.type === 'error' ? '#ef4444' : settings.brandColor }}>
          <div className="bg-white/20 p-1.5 rounded-full shrink-0">
            {notification.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          </div>
          <span className="font-bold text-[11px] uppercase tracking-wide">{notification.message}</span>
        </div>
      )}

      {isReportOpen && <ReportModal />}

      <header className="bg-slate-900 text-white p-5 shadow-2xl sticky top-0 z-40 border-b border-white/5 no-print">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-5">
              <div className="w-16 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg overflow-hidden shrink-0 border border-white/10">
                 <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
              </div>
              <div>
                <h1 className="text-2xl font-black italic tracking-tighter uppercase leading-none text-white">{settings.title}</h1>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] mt-1 flex items-center gap-1.5" style={{ color: `${settings.brandColor}BF` }}>
                  {settings.subtitle} <Cloud size={10} className="text-emerald-400" />
                </p>
              </div>
            </div>
            <button onClick={handleLogout} className="md:hidden p-2 bg-slate-800 rounded-xl text-slate-300 hover:text-white border border-slate-700">
               <LogOut size={18} />
            </button>
          </div>
          
          <div className="flex flex-wrap justify-center bg-slate-800 p-1.5 rounded-2xl border border-white/5 gap-1">
            <button onClick={() => setView('active')} className="px-6 py-2 rounded-xl text-[11px] font-black transition-all flex items-center gap-2" style={view === 'active' ? { backgroundColor: settings.brandColor, color: 'white' } : { color: '#94a3b8' }}>
              <Boxes size={16} /> PAINEL
            </button>
            <button onClick={() => setView('history')} className="px-6 py-2 rounded-xl text-[11px] font-black transition-all flex items-center gap-2" style={view === 'history' ? { backgroundColor: settings.brandColor, color: 'white' } : { color: '#94a3b8' }}>
              <History size={16} /> HISTÓRICO
            </button>
            {currentUser?.permissions?.length > 0 && (
              <button onClick={() => {
                setView('manager');
                if (!currentUser.permissions.includes(managerSubView)) {
                  setManagerSubView(currentUser.permissions[0]);
                }
              }} className="px-6 py-2 rounded-xl text-[11px] font-black transition-all flex items-center gap-2" style={view === 'manager' ? { backgroundColor: settings.brandColor, color: 'white' } : { color: '#94a3b8' }}>
                <Settings size={16} /> GERENCIAL
              </button>
            )}
            <div className="w-px bg-slate-700 mx-1 h-8 self-center"></div>
            <button onClick={() => setIsReportOpen(true)} className="px-6 py-2 rounded-xl text-[11px] font-black transition-all flex items-center gap-2 hover:opacity-80" style={{ color: `${settings.brandColor}BF` }}>
              <FileText size={16} /> RELATÓRIO
            </button>
          </div>

          <div className="hidden md:flex items-center gap-4 bg-slate-800 p-1.5 pr-4 pl-1.5 rounded-2xl border border-white/5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white" style={{ backgroundColor: settings.brandColor }}>
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div className="text-right">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-tight">Operador</p>
              <p className="text-xs font-bold text-white leading-tight">{currentUser.name}</p>
            </div>
            <div className="w-px bg-slate-700 mx-2 h-8"></div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-400 transition-colors p-2" title="Sair do Sistema">
               <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 no-print">
        {view === 'manager' ? (
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white rounded-[3rem] shadow-xl border border-slate-200 overflow-hidden min-h-[600px] flex flex-col md:flex-row">
              <div className="w-full md:w-64 bg-slate-50 border-r border-slate-100 p-6 flex flex-col gap-2">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 px-4">Administração</h3>
                
                {currentUser?.permissions?.includes('identity') && (
                  <button onClick={() => setManagerSubView('identity')} className={`w-full text-left px-5 py-3 rounded-2xl text-[11px] font-black uppercase transition-all flex items-center gap-3 ${managerSubView === 'identity' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:bg-slate-100'}`}>
                    <Palette size={16} style={{ color: managerSubView === 'identity' ? settings.brandColor : 'inherit' }} /> Identidade
                  </button>
                )}
                {currentUser?.permissions?.includes('system_users') && (
                  <button onClick={() => setManagerSubView('system_users')} className={`w-full text-left px-5 py-3 rounded-2xl text-[11px] font-black uppercase transition-all flex items-center gap-3 ${managerSubView === 'system_users' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:bg-slate-100'}`}>
                    <ShieldCheck size={16} style={{ color: managerSubView === 'system_users' ? settings.brandColor : 'inherit' }} /> Usuários
                  </button>
                )}
                <div className="h-px bg-slate-200 my-2 mx-4"></div>
                {currentUser?.permissions?.includes('vehicles') && (
                  <button onClick={() => setManagerSubView('vehicles')} className={`w-full text-left px-5 py-3 rounded-2xl text-[11px] font-black uppercase transition-all flex items-center gap-3 ${managerSubView === 'vehicles' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:bg-slate-100'}`}>
                    <Car size={16} style={{ color: managerSubView === 'vehicles' ? settings.brandColor : 'inherit' }} /> Placas Reg.
                  </button>
                )}
                {currentUser?.permissions?.includes('types') && (
                  <button onClick={() => setManagerSubView('types')} className={`w-full text-left px-5 py-3 rounded-2xl text-[11px] font-black uppercase transition-all flex items-center gap-3 ${managerSubView === 'types' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:bg-slate-100'}`}>
                    <LayoutGrid size={16} style={{ color: managerSubView === 'types' ? settings.brandColor : 'inherit' }} /> Categorias
                  </button>
                )}
                {currentUser?.permissions?.includes('drivers') && (
                  <button onClick={() => setManagerSubView('drivers')} className={`w-full text-left px-5 py-3 rounded-2xl text-[11px] font-black uppercase transition-all flex items-center gap-3 ${managerSubView === 'drivers' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:bg-slate-100'}`}>
                    <Users size={16} style={{ color: managerSubView === 'drivers' ? settings.brandColor : 'inherit' }} /> Motoristas
                  </button>
                )}
              </div>

              <div className="flex-1 p-8 md:p-12 overflow-y-auto max-h-[700px]">
                {managerSubView === 'identity' && (
                  <div className="space-y-10 animate-in fade-in duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-50 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl text-white" style={{ backgroundColor: settings.brandColor }}><Palette size={24} /></div>
                        <h2 className="text-xl font-black uppercase text-slate-800">Personalização</h2>
                      </div>
                      <button onClick={saveSettingsToDb} className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-emerald-600 active:scale-95 transition-all flex items-center gap-2">
                        <Cloud size={16} /> Salvar Identidade
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Título do Topo</label>
                        <input type="text" value={draftSettings.title} onChange={(e) => setDraftSettings({...draftSettings, title: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-black text-sm uppercase transition-all" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Subtítulo (Empresa)</label>
                        <input type="text" value={draftSettings.subtitle} onChange={(e) => setDraftSettings({...draftSettings, subtitle: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-bold text-sm transition-all" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Cor da Marca (HEX)</label>
                        <div className="flex gap-4">
                          <input type="color" value={draftSettings.brandColor} onChange={(e) => setDraftSettings({...draftSettings, brandColor: e.target.value})} className="w-16 h-14 p-1 bg-slate-50 border-2 border-slate-100 rounded-2xl cursor-pointer" />
                          <input type="text" value={draftSettings.brandColor.toUpperCase()} onChange={(e) => setDraftSettings({...draftSettings, brandColor: e.target.value})} className="flex-1 px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-mono font-black text-sm" maxLength={7} />
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">
                        <ImageIcon size={14} /> Configuração da Logomarca
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-50 border border-slate-200 rounded-3xl">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-1">
                              <LinkIcon size={12} /> Via Link (Web)
                            </span>
                            <input type="text" placeholder="https://exemplo.com/logo.png" value={draftSettings.logoUrl.startsWith('data:') ? '' : draftSettings.logoUrl} onChange={(e) => setDraftSettings({...draftSettings, logoUrl: e.target.value})} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none text-[11px] font-bold transition-all" />
                          </div>
                          <div className="relative">
                            <span className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-1 mb-2">
                              <Upload size={12} /> Via Arquivo / Imagem
                            </span>
                            <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileUpload} className="hidden" />
                            <button onClick={() => fileInputRef.current.click()} className="w-full py-3 bg-white border border-slate-200 border-dashed rounded-xl flex items-center justify-center gap-2 text-[11px] font-black uppercase text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-all active:scale-95">
                              <ImageIcon size={14} /> Escolher do Computador
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col items-center justify-center border-l border-slate-200 pl-6 space-y-2">
                          <span className="text-[9px] font-black text-slate-300 uppercase italic">Pré-visualização</span>
                          <div className="w-24 h-16 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center overflow-hidden">
                             <img src={draftSettings.logoUrl} alt="Preview" className="w-full h-full object-contain p-2" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {managerSubView === 'system_users' && (
                  <div className="space-y-8 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between border-b border-slate-50 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl text-white" style={{ backgroundColor: settings.brandColor }}><ShieldCheck size={24} /></div>
                        <h2 className="text-xl font-black uppercase text-slate-800">Contas de Acesso</h2>
                      </div>
                      <span className="text-[10px] font-black bg-slate-100 text-slate-400 px-3 py-1 rounded-full uppercase">{users.length} Usuários</span>
                    </div>
                    
                    <div className="flex flex-col gap-4 p-6 bg-slate-900 rounded-[2rem] shadow-xl">
                      <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="space-y-1.5 w-full md:w-auto flex-1">
                           <label className="text-[9px] font-black text-white/50 uppercase ml-1">Nome de Exibição</label>
                           <input type="text" placeholder="Ex: João Silva" value={newSysUserName} onChange={(e) => setNewSysUserName(e.target.value)} className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs outline-none focus:bg-white/20" />
                        </div>
                        <div className="space-y-1.5 w-full md:w-auto flex-1">
                           <label className="text-[9px] font-black text-white/50 uppercase ml-1">Login</label>
                           <input type="text" placeholder="joao.silva" value={newSysUserLogin} onChange={(e) => setNewSysUserLogin(e.target.value)} className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs outline-none focus:bg-white/20 lowercase" />
                        </div>
                        <div className="space-y-1.5 w-full md:w-auto flex-1">
                           <label className="text-[9px] font-black text-white/50 uppercase ml-1">Senha</label>
                           <input type="password" placeholder="••••••••" value={newSysUserPass} onChange={(e) => setNewSysUserPass(e.target.value)} className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs outline-none focus:bg-white/20" />
                        </div>
                      </div>
                      
                      <div className="pt-4 border-t border-white/10">
                        <label className="text-[9px] font-black text-white/50 uppercase ml-1 mb-3 block">Permissões Gerenciais (O que este usuário pode ver?)</label>
                        <div className="flex flex-wrap gap-4">
                          {AVAILABLE_PERMISSIONS.map(perm => (
                            <label key={perm.id} className="flex items-center gap-2 text-white text-[10px] font-bold cursor-pointer group">
                              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${newSysUserPermissions.includes(perm.id) ? 'bg-emerald-400 border-emerald-400' : 'bg-white/10 border-white/20 group-hover:border-white/40'}`}>
                                {newSysUserPermissions.includes(perm.id) && <CheckCircle2 size={12} className="text-slate-900" />}
                              </div>
                              <input 
                                type="checkbox" 
                                className="hidden"
                                checked={newSysUserPermissions.includes(perm.id)} 
                                onChange={() => {
                                  setNewSysUserPermissions(prev => 
                                    prev.includes(perm.id) ? prev.filter(p => p !== perm.id) : [...prev, perm.id]
                                  );
                                }} 
                              />
                              {perm.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <button onClick={addSystemUser} className="w-full md:w-auto bg-emerald-500 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-600 transition-all flex justify-center items-center gap-2 mt-2 self-start shadow-lg">
                        <Cloud size={16} /> Criar Conta
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {users.map(u => (
                        <div key={u.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-slate-300 transition-all">
                          <div className="flex flex-col md:flex-row md:items-center gap-4">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center font-black text-slate-600 shadow-sm">
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-black text-sm uppercase text-slate-800 leading-tight">{u.name}</p>
                                <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mt-0.5"><UserCircle size={10} /> Login: {u.username}</p>
                              </div>
                            </div>
                            <div className="hidden md:flex flex-wrap gap-1 md:ml-6 border-l border-slate-200 pl-6">
                              {u.permissions?.length === 0 ? (
                                <span className="text-[9px] font-black uppercase text-slate-400">Acesso Restrito ao Painel (Padrão)</span>
                              ) : (
                                u.permissions?.map(p => (
                                  <span key={p} className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-[8px] font-black uppercase">
                                    {AVAILABLE_PERMISSIONS.find(ap => ap.id === p)?.label || p}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                          {u.id !== currentUser.id && (
                            <button onClick={() => removeSystemUser(u.id)} className="p-2 text-slate-300 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all opacity-0 group-hover:opacity-100" title="Remover Usuário">
                              <Trash2 size={16} />
                            </button>
                          )}
                          {u.id === currentUser.id && (
                            <span className="bg-emerald-100 text-emerald-600 px-3 py-1 rounded-full text-[9px] font-black uppercase shrink-0">Sua Conta</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {managerSubView === 'vehicles' && (
                  <div className="space-y-8 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between border-b border-slate-50 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl text-white" style={{ backgroundColor: settings.brandColor }}><Car size={24} /></div>
                        <h2 className="text-xl font-black uppercase text-slate-800">Veículos Registrados</h2>
                      </div>
                      <span className="text-[10px] font-black bg-slate-100 text-slate-400 px-3 py-1 rounded-full uppercase">{Object.keys(knownVehicles).length} Total</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {Object.entries(knownVehicles).length === 0 ? (
                        <p className="text-center py-10 text-slate-300 font-bold uppercase italic">Nenhum veículo no cadastro</p>
                      ) : Object.entries(knownVehicles).map(([p, data]) => (
                        <div key={p} className="group flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-slate-300 hover:bg-white transition-all">
                          <div className="flex items-center gap-6">
                            <span className="font-mono font-black text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200 shadow-sm">{p}</span>
                            <div className="flex flex-col md:flex-row gap-4">
                              <input type="text" defaultValue={data.model} onBlur={(e) => updateKnownVehicle(p, { model: e.target.value.toUpperCase() })} className="bg-transparent font-bold text-xs uppercase outline-none focus:text-blue-600" />
                              <select defaultValue={data.category} onChange={(e) => updateKnownVehicle(p, { category: e.target.value })} className="bg-transparent font-black text-[10px] uppercase text-slate-400 outline-none">
                                {vehicleTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                              </select>
                            </div>
                          </div>
                          <button onClick={() => removeKnownVehicle(p)} className="p-2 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {managerSubView === 'types' && (
                  <div className="space-y-8 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between border-b border-slate-50 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl text-white" style={{ backgroundColor: settings.brandColor }}><LayoutGrid size={24} /></div>
                        <h2 className="text-xl font-black uppercase text-slate-800">Tipos de Veículos</h2>
                      </div>
                    </div>
                    
                    <div className="flex flex-col md:flex-row gap-4 p-6 bg-slate-900 rounded-[2rem] shadow-xl">
                      <input type="text" placeholder="NOME DO TIPO (EX: VAN)" value={newTypeLabel} onChange={(e) => setNewTypeLabel(e.target.value)} className="flex-1 bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs uppercase outline-none focus:bg-white/20" />
                      <select value={newTypeGroup} onChange={(e) => setNewTypeGroup(e.target.value)} className="bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs uppercase outline-none">
                        {GROUPS.map(g => <option key={g.id} value={g.id}>{g.label.toUpperCase()}</option>)}
                      </select>
                      <button onClick={() => {addVehicleType(newTypeLabel, newTypeGroup); setNewTypeLabel('');}} className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg">
                        <Cloud size={16} /> Incluir
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {vehicleTypes.map(type => (
                        <div key={type.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group">
                          <div>
                            <p className="font-black text-xs uppercase text-slate-800">{type.label}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{GROUPS.find(g => g.id === type.group)?.label}</p>
                          </div>
                          <button onClick={() => removeVehicleType(type.id)} className="p-2 text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100">
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {managerSubView === 'drivers' && (
                  <div className="space-y-8 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between border-b border-slate-50 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl text-white" style={{ backgroundColor: settings.brandColor }}><Users size={24} /></div>
                        <h2 className="text-xl font-black uppercase text-slate-800">Cadastro de Motoristas</h2>
                      </div>
                    </div>
                    
                    <div className="flex gap-4 p-6 bg-slate-50 border border-slate-200 rounded-[2rem]">
                      <input type="text" placeholder="NOME DO MOTORISTA" value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)} className="flex-1 px-5 py-3 bg-white border border-slate-200 rounded-xl font-bold text-xs uppercase outline-none focus:border-blue-400" />
                      <button onClick={() => {addDriver(newDriverName); setNewDriverName('');}} className="bg-emerald-500 px-6 py-3 text-white rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-emerald-600 active:scale-95 flex items-center gap-2">
                        <Cloud size={16} /> Adicionar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {knownDrivers.length === 0 ? (
                        <p className="col-span-full text-center py-10 text-slate-300 font-bold italic uppercase">Nenhum motorista cadastrado</p>
                      ) : knownDrivers.map(name => (
                        <div key={name} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl hover:shadow-md transition-all group">
                          <span className="font-bold text-xs uppercase text-slate-600">{name}</span>
                          <button onClick={() => removeDriver(name)} className="text-slate-200 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-3">
              <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 sticky top-32">
                <h2 className="text-xs font-black mb-6 flex items-center gap-2 uppercase tracking-[0.2em] border-b border-slate-50 pb-4 leading-none" style={{ color: settings.brandColor }}>
                  <LogIn size={18} /> Registro Rápido
                </h2>
                
                <div className="mb-6 p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100/50">
                  <label className="flex items-center gap-1.5 text-[10px] font-black text-indigo-900 uppercase tracking-widest mb-2">
                    <Sparkles size={12} className="text-indigo-600" /> Assistente Inteligente
                  </label>
                  <textarea 
                    value={aiInputText} 
                    onChange={e => setAiInputText(e.target.value)} 
                    placeholder="Ex: O João entrou com a carreta scania placa XYZ1234" 
                    className="w-full px-3 py-2 bg-white border border-indigo-100 rounded-xl outline-none font-medium text-xs text-slate-700 resize-none h-16 mb-2 focus:border-indigo-300"
                  />
                  <button 
                    onClick={handleMagicFill} 
                    disabled={isAiLoading}
                    className="w-full bg-indigo-600 text-white font-black py-2.5 rounded-xl shadow-md transition-all text-[10px] uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 flex justify-center items-center gap-2"
                  >
                    {isAiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 
                    {isAiLoading ? 'Analisando...' : '✨ Preencher Form'}
                  </button>
                </div>

                <div className="relative flex py-2 items-center mb-6">
                  <div className="flex-grow border-t border-slate-100"></div>
                  <span className="flex-shrink-0 mx-4 text-slate-300 text-[10px] font-black uppercase tracking-widest">Ou Digite</span>
                  <div className="flex-grow border-t border-slate-100"></div>
                </div>

                <form onSubmit={handleEntry} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Placa</label>
                    <input type="text" value={plate} onChange={(e) => handlePlateChange(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-mono font-black text-xl transition-all uppercase" placeholder="ABC-1234" maxLength={8} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Modelo</label>
                    <input type="text" value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-bold text-sm uppercase" placeholder="Modelo do Veículo" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Tipo</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-bold text-sm uppercase">
                      <option value="">Selecione...</option>
                      {vehicleTypes.map(cat => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Motorista</label>
                    <input list="drivers-list" type="text" value={driver} onChange={(e) => setDriver(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white outline-none font-bold text-sm uppercase" placeholder="Nome do Motorista" />
                    <datalist id="drivers-list">
                      {knownDrivers.map(d => <option key={d} value={d} />)}
                    </datalist>
                  </div>
                  <button type="submit" className="w-full hover:opacity-90 text-white font-black py-4 rounded-2xl shadow-xl transition-all text-xs uppercase tracking-[0.2em] mt-2 active:scale-95 flex items-center justify-center gap-2" style={{ backgroundColor: settings.brandColor }}>
                    <Cloud size={16} /> Sincronizar Entrada
                  </button>
                </form>
              </div>
            </div>

            <div className="lg:col-span-9">
              {view === 'active' ? (
                <div className="space-y-10">
                  <section>
                    <div className="flex items-center justify-between mb-5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 text-orange-600 rounded-2xl shadow-sm"><Container size={24} /></div>
                        <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl italic">Pesados</h2>
                      </div>
                      <span className="bg-orange-500 text-white text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-lg">{heavyQueue.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {heavyQueue.length === 0 ? <div className="col-span-full py-12 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3rem] text-slate-300 text-[11px] font-black uppercase">Pátio Livre</div> : heavyQueue.map(v => <VehicleCard key={v.id} vehicle={v} colorClass="bg-orange-50 text-orange-600" />)}
                    </div>
                  </section>
                  <section>
                    <div className="flex items-center justify-between mb-5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-2xl shadow-sm" style={{ color: settings.brandColor }}><Truck size={24} /></div>
                        <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl italic" style={{ color: settings.brandColor }}>Médios</h2>
                      </div>
                      <span className="text-white text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-lg" style={{ backgroundColor: settings.brandColor }}>{mediumQueue.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {mediumQueue.length === 0 ? <div className="col-span-full py-12 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3rem] text-slate-300 text-[11px] font-black uppercase">Pátio Livre</div> : mediumQueue.map(v => <VehicleCard key={v.id} vehicle={v} colorClass="bg-blue-50" />)}
                    </div>
                  </section>
                  <section className="bg-white/40 p-8 rounded-[3.5rem] border border-slate-200 border-dashed text-slate-900">
                    <div className="flex items-center gap-3 mb-6"><Car className="text-slate-400" size={20} /><h2 className="font-black text-slate-400 uppercase tracking-tighter text-lg italic italic">Outros Veículos</h2></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      {others.length === 0 ? <p className="col-span-full text-center text-slate-300 text-[10px] font-black uppercase py-4">Sem veículos leves</p> : others.map(v => <VehicleCard key={v.id} vehicle={v} colorClass="bg-slate-100 text-slate-500" />)}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-black uppercase tracking-wider text-xs" style={{ color: settings.brandColor }}>
                        <Filter size={18} /> Filtros de Pesquisa
                      </div>
                      <button onClick={resetFilters} className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase flex items-center gap-1 transition-all">
                        <X size={14} /> Limpar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="text" placeholder="PLACA, MOTORISTA..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold outline-none transition-all uppercase" />
                      </div>

                      <div className="relative">
                        <LayoutGrid className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <select value={filterGroup} onChange={(e) => {setFilterGroup(e.target.value); setFilterCatDetail('all');}} className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold outline-none appearance-none uppercase">
                          <option value="all">TODOS OS GRUPOS</option>
                          {GROUPS.map(g => <option key={g.id} value={g.id}>{g.label.toUpperCase()}</option>)}
                        </select>
                      </div>

                      <div className="relative">
                        <Truck className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <select value={filterCatDetail} onChange={(e) => setFilterCatDetail(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold outline-none appearance-none uppercase">
                          <option value="all">TODOS OS TIPOS</option>
                          {vehicleTypes.filter(c => filterGroup === 'all' || c.group === filterGroup).map(c => <option key={c.id} value={c.id}>{c.label.toUpperCase()}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-row items-center gap-2 w-full overflow-hidden">
                        <div className="relative flex-1 min-w-[105px]">
                          <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-full pl-7 pr-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none appearance-none transition-all" />
                        </div>
                        <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 shrink-0 gap-0.5">
                          <button onClick={() => setFilterType('entry')} className="w-8 h-8 flex items-center justify-center rounded-lg text-[11px] font-black transition-all" style={filterType === 'entry' ? { backgroundColor: 'white', color: settings.brandColor, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' } : { color: '#94a3b8' }}>E</button>
                          <button onClick={() => setFilterType('exit')} className="w-8 h-8 flex items-center justify-center rounded-lg text-[11px] font-black transition-all" style={filterType === 'exit' ? { backgroundColor: 'white', color: settings.brandColor, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' } : { color: '#94a3b8' }}>S</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {aiInsights && (
                    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 rounded-[2rem] border border-indigo-100 shadow-sm relative">
                      <button onClick={() => setAiInsights(null)} className="absolute top-4 right-4 text-indigo-400 hover:text-indigo-600"><X size={18} /></button>
                      <h3 className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-2 mb-3">
                        <BrainCircuit size={16} /> Insights da Operação (IA)
                      </h3>
                      <p className="text-xs text-indigo-800/80 leading-relaxed font-medium whitespace-pre-line">
                        {aiInsights}
                      </p>
                    </div>
                  )}

                  <div className="bg-white rounded-[3rem] shadow-sm border border-slate-200 overflow-hidden text-slate-900">
                    <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-50/50 gap-4">
                      <h2 className="text-xs font-black text-slate-800 uppercase tracking-widest italic">Histórico Operacional ({filteredHistory.length})</h2>
                      <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                        <button 
                          onClick={() => generateInsights(filteredHistory)}
                          disabled={insightsLoading}
                          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50"
                        >
                          {insightsLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 
                          {insightsLoading ? 'Processando...' : '✨ Gerar Insights'}
                        </button>
                        <button onClick={clearHistory} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={20} /></button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest">Veículo</th>
                            <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest">Motorista</th>
                            <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest">Tipo</th>
                            <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest text-center">Permanência</th>
                            <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest">Detalhes da Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {filteredHistory.length === 0 ? (
                            <tr><td colSpan="5" className="px-8 py-20 text-center text-slate-300 font-bold uppercase tracking-widest italic">Nenhum registro encontrado</td></tr>
                          ) : (
                            filteredHistory.map(record => (
                              <tr key={record.id} className="hover:bg-slate-50/80 transition-colors group">
                                <td className="px-8 py-5">
                                  <p className="font-black text-slate-900 text-sm italic tracking-tighter uppercase leading-tight">{record.plate}</p>
                                  <p className="text-[9px] text-slate-400 font-bold uppercase truncate max-w-[150px]">{record.model}</p>
                                </td>
                                <td className="px-8 py-5">
                                  <p className="font-bold text-slate-700 uppercase tracking-tight">{record.driver}</p>
                                </td>
                                <td className="px-8 py-5">
                                  <span className="bg-slate-100 px-2.5 py-1 rounded-lg font-black uppercase text-[9px] text-slate-500 border border-slate-200">
                                    {vehicleTypes.find(t => t.id === record.category)?.label || record.category}
                                  </span>
                                </td>
                                <td className="px-8 py-5 text-center">
                                  <span className="bg-slate-900 text-white px-4 py-1.5 rounded-xl font-black italic tracking-tighter shadow-md">{record.duration}</span>
                                </td>
                                <td className="px-8 py-5">
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2 font-black text-[10px] uppercase" style={{ color: settings.brandColor }}>
                                      <LogIn size={12} /> {record.entryTime} 
                                      {record.entryOperator && <span className="text-[8px] text-slate-400 font-bold tracking-widest px-1 bg-white rounded border border-slate-100 hidden md:inline-block">POR {record.entryOperator.split(' ')[0]}</span>}
                                    </div>
                                    <div className="flex items-center gap-2 font-black text-[10px] text-red-400 uppercase">
                                      <LogOut size={12} /> {record.exitTime}
                                      {record.exitOperator && <span className="text-[8px] text-slate-300 font-bold tracking-widest px-1 bg-white rounded border border-slate-100 hidden md:inline-block">POR {record.exitOperator.split(' ')[0]}</span>}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-slate-200 flex justify-center items-center z-50 text-slate-900">
        <div className="flex items-center gap-12 text-slate-900">
          <div className="flex items-center gap-2">
            <Cloud size={14} fill="currentColor" className="text-emerald-500" />
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Nuvem Sincronizada</span>
          </div>
          <div className="h-4 w-px bg-slate-200"></div>
          <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic leading-none">{settings.subtitle}</p>
        </div>
      </footer>
    </div>
  );
}
